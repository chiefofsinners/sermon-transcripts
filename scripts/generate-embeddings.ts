import "dotenv/config";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { chunkTranscript, embeddingText } from "../src/lib/chunking";
import { embed } from "../src/lib/embeddings";
import { canonicalPreacher } from "../src/lib/preachers";
import type { SermonData } from "../src/lib/types";

const DATA_DIR = join(process.cwd(), "data", "sermons");
const SERIES_CACHE = join(process.cwd(), "data", "series-names.json");
const EMBEDDING_BATCH_SIZE = 96;
const SELECT_PAGE_SIZE = 1000;
const UPSERT_BATCH_SIZE = 5;
const UPSERT_MAX_RETRIES = 5;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry transient Postgres errors (statement timeouts, often from cold/slow
// compute on the first heavy write) with exponential backoff.
async function upsertChunksWithRetry(
  rows: Record<string, unknown>[]
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const { error } = await supabase
      .from("sermon_chunks")
      .upsert(rows, { onConflict: "sermon_id,chunk_index" });
    if (!error) return;

    const transient = /timeout|canceling statement|fetch failed|ECONNRESET/i.test(
      error.message
    );
    if (!transient || attempt >= UPSERT_MAX_RETRIES) {
      throw new Error(`Upsert error: ${error.message}`);
    }
    const backoff = 1000 * 2 ** (attempt - 1);
    console.warn(
      `\n  Upsert attempt ${attempt} failed (${error.message}); retrying in ${backoff}ms...`
    );
    await sleep(backoff);
  }
}

interface ChunkRecord {
  id: string;
  text: string;
  sermonID: string;
  chunkIndex: number;
  embeddingInput: string;
}

/** seriesID -> series title, refreshed by generate-index.ts from the SermonAudio API. */
function loadSeriesNames(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(SERIES_CACHE, "utf-8"));
  } catch {
    console.warn("No data/series-names.json — series names will be left null");
    return {};
  }
}

function loadSermons(): SermonData[] {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  console.log(`Found ${files.length} sermon files`);
  return files.map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf-8")));
}

function buildChunks(
  sermons: SermonData[],
  seriesNames: Record<string, string>
): ChunkRecord[] {
  const chunks: ChunkRecord[] = [];
  for (const sermon of sermons) {
    if (!sermon.transcript || sermon.transcript.trim().length === 0) continue;

    const metadata = {
      title: sermon.title || sermon.displayTitle,
      preacher: canonicalPreacher(sermon.preacher),
      bibleText: sermon.bibleText || "",
      preachDate: sermon.preachDate || "",
      series: (sermon.series && seriesNames[sermon.series]) || "",
      subtitle: sermon.subtitle || "",
      keywords: sermon.keywords || "",
    };

    const textChunks = chunkTranscript(sermon.transcript);
    for (let i = 0; i < textChunks.length; i++) {
      chunks.push({
        id: `${sermon.sermonID}_${i}`,
        text: textChunks[i],
        sermonID: sermon.sermonID,
        chunkIndex: i,
        embeddingInput: embeddingText(metadata, textChunks[i]),
      });
    }
  }
  return chunks;
}

async function getExistingChunkIds(): Promise<Set<string>> {
  const existing = new Set<string>();
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from("sermon_chunks")
      .select("sermon_id, chunk_index")
      .order("id")
      .range(offset, offset + SELECT_PAGE_SIZE - 1);

    if (error) {
      console.warn("Could not list existing chunks:", error.message);
      break;
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      existing.add(`${row.sermon_id}_${row.chunk_index}`);
    }
    offset += SELECT_PAGE_SIZE;
  }

  return existing;
}

/**
 * Repair metadata drift on sermon rows that are already in the vector store.
 *
 * Two things go stale here: a preacher whose SermonAudio display name we now
 * canonicalise differently (see src/lib/preachers.ts), and series_name, which
 * is filled in from data/series-names.json and so changes whenever that cache
 * is refreshed. Both are used as AI-search filters, and a stale value means a
 * filtered search silently returns nothing.
 *
 * Only rows that actually differ are written, so this is a no-op in the common
 * case.
 */
async function syncMetadata(
  sermons: SermonData[],
  seriesNames: Record<string, string>
): Promise<void> {
  // PostgREST caps a select at 1000 rows, so this has to be paged — ordered by
  // primary key so the pages don't shift underneath us.
  const rows: { sermon_id: string; preacher: string; series: string | null; series_name: string | null }[] = [];
  for (let offset = 0; ; offset += SELECT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("sermons")
      .select("sermon_id, preacher, series, series_name")
      .order("sermon_id")
      .range(offset, offset + SELECT_PAGE_SIZE - 1);
    if (error) {
      console.warn("Could not read sermon metadata for sync:", error.message);
      return;
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < SELECT_PAGE_SIZE) break;
  }

  const bySermonId = new Map(sermons.map((s) => [s.sermonID, s]));
  const fixes: { sermon_id: string; preacher: string; series_name: string | null }[] = [];

  for (const row of rows) {
    const source = bySermonId.get(row.sermon_id);
    // Rows with no local file (e.g. a sermon since removed from data/) are left alone.
    if (!source) continue;

    const preacher = canonicalPreacher(source.preacher);
    const seriesName = (row.series && seriesNames[row.series]) || null;

    if (row.preacher !== preacher || row.series_name !== seriesName) {
      fixes.push({ sermon_id: row.sermon_id, preacher, series_name: seriesName });
    }
  }

  if (fixes.length === 0) {
    console.log("Metadata in sync — nothing to correct.");
    return;
  }

  // Most corrections share the same target values (a whole series being
  // backfilled at once, say), so group by value and issue one UPDATE per
  // distinct pair rather than one per sermon.
  const groups = new Map<string, { preacher: string; series_name: string | null; ids: string[] }>();
  for (const fix of fixes) {
    const key = `${fix.preacher}\u0000${fix.series_name ?? ""}`;
    const group = groups.get(key);
    if (group) group.ids.push(fix.sermon_id);
    else groups.set(key, { preacher: fix.preacher, series_name: fix.series_name, ids: [fix.sermon_id] });
  }

  console.log(
    `Correcting metadata on ${fixes.length} sermon(s) in ${groups.size} update(s)...`
  );
  for (const group of groups.values()) {
    const { error: updateError } = await supabase
      .from("sermons")
      .update({ preacher: group.preacher, series_name: group.series_name })
      .in("sermon_id", group.ids);
    if (updateError) {
      console.warn(`  ${group.ids.length} sermon(s) failed: ${updateError.message}`);
    }
  }
}

/**
 * Remove chunks that the current data no longer produces — a transcript that
 * was shortened leaves its trailing chunk_index values behind, and a sermon
 * deleted from data/ leaves all of them.
 *
 * Only runs after a rebuild, and only after the replacements have been written,
 * so the vector store is never missing content mid-run. (The old destructive
 * rebuild achieved the same tidiness by emptying the table up front, which took
 * AI search down for the length of the run.)
 */
async function pruneStaleChunks(
  allChunks: ChunkRecord[],
  existingIds: Set<string>
): Promise<void> {
  const currentIds = new Set(allChunks.map((c) => c.id));
  const stale = [...existingIds].filter((id) => !currentIds.has(id));

  if (stale.length === 0) {
    console.log("\nNo stale chunks to prune.");
    return;
  }

  // Chunk ids are `${sermonID}_${chunkIndex}`; group them back up so each
  // sermon needs only one delete.
  const bySermon = new Map<string, number[]>();
  for (const id of stale) {
    const split = id.lastIndexOf("_");
    const sermonId = id.slice(0, split);
    const chunkIndex = Number(id.slice(split + 1));
    const indices = bySermon.get(sermonId);
    if (indices) indices.push(chunkIndex);
    else bySermon.set(sermonId, [chunkIndex]);
  }

  console.log(`\nPruning ${stale.length} stale chunk(s) across ${bySermon.size} sermon(s)...`);
  for (const [sermonId, chunkIndices] of bySermon) {
    const { error } = await supabase
      .from("sermon_chunks")
      .delete()
      .eq("sermon_id", sermonId)
      .in("chunk_index", chunkIndices);
    if (error) console.warn(`  ${sermonId}: ${error.message}`);
  }
}

async function main() {
  const rebuild = process.argv.includes("--rebuild");

  console.log("Using Supabase vector store");
  if (rebuild) {
    console.log(
      "Rebuild mode: re-embedding every chunk in place. Existing rows are " +
        "overwritten as their replacements arrive, so AI search keeps working " +
        "throughout; anything left over is pruned at the end."
    );
  }

  // Load and chunk sermons
  const seriesNames = loadSeriesNames();
  const sermons = loadSermons();
  const allChunks = buildChunks(sermons, seriesNames);
  console.log(`Total chunks: ${allChunks.length} from ${sermons.length} sermons`);

  // Bring existing rows' filterable metadata up to date before indexing.
  await syncMetadata(sermons, seriesNames);

  // Find which chunks need embedding
  console.log("Checking existing chunks...");
  const existingIds = await getExistingChunkIds();
  console.log(`Existing chunks: ${existingIds.size}`);

  const newChunks = rebuild
    ? allChunks
    : allChunks.filter((c) => !existingIds.has(c.id));
  if (newChunks.length === 0) {
    console.log("All chunks already indexed. Nothing to do.");
    return;
  }

  console.log(
    rebuild
      ? `Chunks to re-embed: ${newChunks.length}`
      : `New chunks to index: ${newChunks.length}`
  );

  // Upsert parent sermon rows for any new chunks (FK constraint)
  const newSermonIds = [...new Set(newChunks.map((c) => c.sermonID))];
  const sermonsById = new Map(sermons.map((s) => [s.sermonID, s]));
  console.log(`Upserting ${newSermonIds.length} sermon(s) to satisfy FK constraint...`);
  for (let i = 0; i < newSermonIds.length; i += UPSERT_BATCH_SIZE) {
    const batch = newSermonIds.slice(i, i + UPSERT_BATCH_SIZE);
    const rows = batch.map((id) => {
      const s = sermonsById.get(id)!;
      return {
        sermon_id: s.sermonID,
        title: s.title || s.displayTitle,
        preacher: canonicalPreacher(s.preacher),
        preach_date: s.preachDate || null,
        bible_text: s.bibleText || null,
        series: s.series || null,
        series_name: (s.series && seriesNames[s.series]) || null,
        event_type: s.eventType || null,
        keywords: s.keywords || null,
        subtitle: s.subtitle || null,
        transcript: s.transcript,
      };
    });
    const { error } = await supabase
      .from("sermons")
      .upsert(rows, { onConflict: "sermon_id" });
    if (error) throw new Error(`Sermon upsert error: ${error.message}`);
  }

  // Generate embeddings and upsert in batches
  console.log("Generating embeddings and upserting...");
  for (let i = 0; i < newChunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = newChunks.slice(i, i + EMBEDDING_BATCH_SIZE);
    const texts = batch.map((c) => c.embeddingInput);

    const embeddings = await embed(texts, "passage");

    // Upsert to Supabase in sub-batches
    for (let j = 0; j < batch.length; j += UPSERT_BATCH_SIZE) {
      const subBatch = batch.slice(j, j + UPSERT_BATCH_SIZE);
      const rows = subBatch.map((chunk, k) => ({
        sermon_id: chunk.sermonID,
        chunk_index: chunk.chunkIndex,
        text: chunk.text,
        embedding: JSON.stringify(embeddings[j + k]),
      }));

      await upsertChunksWithRetry(rows);
    }

    process.stdout.write(
      `  Processed ${Math.min(i + EMBEDDING_BATCH_SIZE, newChunks.length)}/${newChunks.length} chunks\r`
    );
  }

  if (rebuild) {
    await pruneStaleChunks(allChunks, existingIds);
  }

  console.log(
    rebuild
      ? `\nDone! Re-embedded ${newChunks.length} chunks.`
      : `\nDone! Indexed ${newChunks.length} new chunks.`
  );
  console.log(
    `Total chunks: ${rebuild ? allChunks.length : existingIds.size + newChunks.length}`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
