import "dotenv/config";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { chunkTranscript, embeddingText } from "../src/lib/chunking";
import { embed } from "../src/lib/embeddings";
import type { SermonData } from "../src/lib/types";

const DATA_DIR = join(process.cwd(), "data", "sermons");
const EMBEDDING_BATCH_SIZE = 96;
const UPSERT_BATCH_SIZE = 100;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface ChunkRecord {
  id: string;
  text: string;
  sermonID: string;
  chunkIndex: number;
  embeddingInput: string;
}

function loadSermons(): SermonData[] {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  console.log(`Found ${files.length} sermon files`);
  return files.map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf-8")));
}

function buildChunks(sermons: SermonData[]): ChunkRecord[] {
  const chunks: ChunkRecord[] = [];
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
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("sermon_chunks")
      .select("sermon_id, chunk_index")
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.warn("Could not list existing chunks:", error.message);
      break;
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      existing.add(`${row.sermon_id}_${row.chunk_index}`);
    }
    offset += pageSize;
  }

  return existing;
}

async function main() {
  const rebuild = process.argv.includes("--rebuild");

  console.log("Using Supabase vector store");
  if (rebuild) console.log("Rebuild mode: will delete all existing chunks first");

  if (rebuild) {
    const { error } = await supabase.from("sermon_chunks").delete().neq("id", 0);
    if (error) console.warn("Delete error:", error.message);
    else console.log("Deleted all existing chunks");
  }

  // Load and chunk sermons
  const sermons = loadSermons();
  const allChunks = buildChunks(sermons);
  console.log(`Total chunks: ${allChunks.length} from ${sermons.length} sermons`);

  // Find which chunks are new
  console.log("Checking existing chunks...");
  const existingIds = await getExistingChunkIds();
  console.log(`Existing chunks: ${existingIds.size}`);

  const newChunks = allChunks.filter((c) => !existingIds.has(c.id));
  if (newChunks.length === 0) {
    console.log("All chunks already indexed. Nothing to do.");
    return;
  }

  console.log(`New chunks to index: ${newChunks.length}`);

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

      const { error } = await supabase.from("sermon_chunks").upsert(rows, {
        onConflict: "sermon_id,chunk_index",
      });
      if (error) throw new Error(`Upsert error: ${error.message}`);
    }

    process.stdout.write(
      `  Processed ${Math.min(i + EMBEDDING_BATCH_SIZE, newChunks.length)}/${newChunks.length} chunks\r`
    );
  }

  console.log(`\nDone! Indexed ${newChunks.length} new chunks.`);
  console.log(`Total chunks: ${existingIds.size + newChunks.length}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
