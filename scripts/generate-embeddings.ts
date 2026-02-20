import "dotenv/config";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import type { SermonData } from "../src/lib/types";

const DATA_DIR = join(process.cwd(), "data", "sermons");
const CHUNK_SIZE = 500; // words
const CHUNK_OVERLAP = 50; // words
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_BATCH_SIZE = 100;
const UPSERT_BATCH_SIZE = 100;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });

interface ChunkRecord {
  id: string;
  text: string;
  metadata: {
    sermonID: string;
    title: string;
    preacher: string;
    preachDate: string;
    bibleText: string;
    chunkIndex: number;
  };
}

function chunkTranscript(transcript: string): string[] {
  const words = transcript.split(/\s+/);
  if (words.length <= CHUNK_SIZE) return [transcript];

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + CHUNK_SIZE, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end >= words.length) break;
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
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

    const textChunks = chunkTranscript(sermon.transcript);
    for (let i = 0; i < textChunks.length; i++) {
      chunks.push({
        id: `${sermon.sermonID}_${i}`,
        text: textChunks[i],
        metadata: {
          sermonID: sermon.sermonID,
          title: sermon.title || sermon.displayTitle,
          preacher: sermon.preacher,
          preachDate: sermon.preachDate || "",
          bibleText: sermon.bibleText || "",
          chunkIndex: i,
        },
      });
    }
  }
  return chunks;
}

async function getExistingIds(index: ReturnType<Pinecone["index"]>, namespace: string): Promise<Set<string>> {
  const existing = new Set<string>();
  try {
    const ns = index.namespace(namespace);
    // List all vector IDs using pagination
    let paginationToken: string | undefined;
    do {
      const page = await ns.listPaginated({ limit: 100, paginationToken });
      for (const v of page.vectors ?? []) {
        if (v.id) existing.add(v.id);
      }
      paginationToken = page.pagination?.next;
    } while (paginationToken);
  } catch (err) {
    console.warn("Could not list existing vectors (index may be empty):", (err as Error).message);
  }
  return existing;
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const res = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch,
    });
    for (const item of res.data) {
      embeddings.push(item.embedding);
    }
    if (i + EMBEDDING_BATCH_SIZE < texts.length) {
      process.stdout.write(`  Embedded ${Math.min(i + EMBEDDING_BATCH_SIZE, texts.length)}/${texts.length} chunks\r`);
    }
  }
  return embeddings;
}

async function main() {
  const indexName = process.env.PINECONE_INDEX || "sermon-transcripts";
  const namespace = process.env.PINECONE_NAMESPACE || "";

  console.log(`Using Pinecone index: ${indexName}${namespace ? `, namespace: ${namespace}` : ""}`);

  const index = pinecone.index(indexName);

  // Load and chunk sermons
  const sermons = loadSermons();
  const allChunks = buildChunks(sermons);
  console.log(`Total chunks: ${allChunks.length} from ${sermons.length} sermons`);

  // Find which chunks are new
  console.log("Checking existing vectors...");
  const existingIds = await getExistingIds(index, namespace);
  console.log(`Existing vectors: ${existingIds.size}`);

  const newChunks = allChunks.filter((c) => !existingIds.has(c.id));
  if (newChunks.length === 0) {
    console.log("All chunks already indexed. Nothing to do.");
    return;
  }

  console.log(`New chunks to index: ${newChunks.length}`);

  // Generate embeddings
  console.log("Generating embeddings...");
  const embeddings = await generateEmbeddings(newChunks.map((c) => c.text));
  console.log(`\nGenerated ${embeddings.length} embeddings`);

  // Upsert to Pinecone
  console.log("Upserting to Pinecone...");
  const ns = namespace ? index.namespace(namespace) : index;
  for (let i = 0; i < newChunks.length; i += UPSERT_BATCH_SIZE) {
    const batch = newChunks.slice(i, i + UPSERT_BATCH_SIZE);
    const vectors = batch.map((chunk, j) => ({
      id: chunk.id,
      values: embeddings[i + j],
      metadata: {
        ...chunk.metadata,
        text: chunk.text,
      },
    }));
    await ns.upsert(vectors);
    process.stdout.write(`  Upserted ${Math.min(i + UPSERT_BATCH_SIZE, newChunks.length)}/${newChunks.length}\r`);
  }

  console.log(`\nDone! Indexed ${newChunks.length} new chunks.`);
  console.log(`Total vectors: ${existingIds.size + newChunks.length}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
