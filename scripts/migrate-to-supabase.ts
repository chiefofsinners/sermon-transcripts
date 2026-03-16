import "dotenv/config";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { chunkTranscript, embeddingText } from "../src/lib/chunking";
import { embed } from "../src/lib/embeddings";
import type { SermonData } from "../src/lib/types";

const DATA_DIR = join(process.cwd(), "data", "sermons");
const EMBEDDING_BATCH_SIZE = 96;
const DB_INSERT_BATCH_SIZE = 100;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function loadSermons(): SermonData[] {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  console.log(`Found ${files.length} sermon files`);
  return files.map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf-8")));
}

async function insertSermons(sermons: SermonData[]) {
  console.log("Inserting sermons...");
  for (let i = 0; i < sermons.length; i += DB_INSERT_BATCH_SIZE) {
    const batch = sermons.slice(i, i + DB_INSERT_BATCH_SIZE);
    const rows = batch
      .filter((s) => s.transcript && s.transcript.trim().length > 0)
      .map((s) => ({
        sermon_id: s.sermonID,
        title: s.title || s.displayTitle,
        preacher: s.preacher,
        preach_date: s.preachDate || null,
        bible_text: s.bibleText || null,
        series: s.series || null,
        event_type: s.eventType || null,
        keywords: s.keywords || null,
        subtitle: s.subtitle || null,
        transcript: s.transcript,
      }));

    const { error } = await supabase.from("sermons").upsert(rows, { onConflict: "sermon_id" });
    if (error) throw new Error(`Sermon insert error: ${error.message}`);
    process.stdout.write(`  Inserted ${Math.min(i + DB_INSERT_BATCH_SIZE, sermons.length)}/${sermons.length} sermons\r`);
  }
  console.log();
}

interface ChunkRow {
  sermon_id: string;
  chunk_index: number;
  text: string;
  embeddingInput: string;
}

function buildChunkRows(sermons: SermonData[]): ChunkRow[] {
  const rows: ChunkRow[] = [];
  for (const sermon of sermons) {
    if (!sermon.transcript || sermon.transcript.trim().length === 0) continue;

    const metadata = {
      title: sermon.title || sermon.displayTitle,
      preacher: sermon.preacher,
      bibleText: sermon.bibleText || "",
      preachDate: sermon.preachDate || "",
      series: sermon.series || "",
      subtitle: sermon.subtitle || "",
      keywords: sermon.keywords || "",
    };

    const chunks = chunkTranscript(sermon.transcript);
    for (let i = 0; i < chunks.length; i++) {
      rows.push({
        sermon_id: sermon.sermonID,
        chunk_index: i,
        text: chunks[i],
        embeddingInput: embeddingText(metadata, chunks[i]),
      });
    }
  }
  return rows;
}

async function generateAndInsertChunks(chunkRows: ChunkRow[]) {
  console.log(`Generating embeddings and inserting ${chunkRows.length} chunks...`);

  for (let i = 0; i < chunkRows.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = chunkRows.slice(i, i + EMBEDDING_BATCH_SIZE);
    const texts = batch.map((c) => c.embeddingInput);

    // Generate embeddings
    const embeddings = await embed(texts, "passage");

    // Build DB rows
    const dbRows = batch.map((c, j) => ({
      sermon_id: c.sermon_id,
      chunk_index: c.chunk_index,
      text: c.text,
      embedding: JSON.stringify(embeddings[j]),
    }));

    // Insert in sub-batches
    for (let k = 0; k < dbRows.length; k += DB_INSERT_BATCH_SIZE) {
      const subBatch = dbRows.slice(k, k + DB_INSERT_BATCH_SIZE);
      const { error } = await supabase.from("sermon_chunks").upsert(subBatch, {
        onConflict: "sermon_id,chunk_index",
      });
      if (error) throw new Error(`Chunk insert error: ${error.message}`);
    }

    process.stdout.write(
      `  Processed ${Math.min(i + EMBEDDING_BATCH_SIZE, chunkRows.length)}/${chunkRows.length} chunks\r`
    );
  }
  console.log();
}

async function main() {
  console.log("=== Migrate to Supabase ===");

  const sermons = loadSermons();

  // 1. Insert sermon metadata + transcripts
  await insertSermons(sermons);

  // 2. Chunk and embed
  const chunkRows = buildChunkRows(sermons);
  console.log(`Total chunks: ${chunkRows.length} from ${sermons.length} sermons`);

  await generateAndInsertChunks(chunkRows);

  // 3. Verify counts
  const { count: sermonCount } = await supabase
    .from("sermons")
    .select("*", { count: "exact", head: true });
  const { count: chunkCount } = await supabase
    .from("sermon_chunks")
    .select("*", { count: "exact", head: true });

  console.log(`Done! Sermons: ${sermonCount}, Chunks: ${chunkCount}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
