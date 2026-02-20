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
    series: string;
    eventType: string;
    keywords: string;
    subtitle: string;
    chunkIndex: number;
  };
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Split transcript into chunks of ~CHUNK_SIZE words, breaking at paragraph
 * or sentence boundaries. Consecutive short paragraphs are merged together;
 * long paragraphs are split at sentence boundaries within them.
 */
function chunkTranscript(transcript: string): string[] {
  if (wordCount(transcript) <= CHUNK_SIZE) return [transcript.trim()];

  // Split into paragraphs (double-newline or more)
  const paragraphs = transcript.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  // Further split long paragraphs into sentences
  const segments: string[] = [];
  for (const para of paragraphs) {
    if (wordCount(para) <= CHUNK_SIZE) {
      segments.push(para);
    } else {
      // Split on sentence boundaries: period/question/exclamation followed by space + uppercase
      const sentences = para.match(/[^.!?]*[.!?]+(?:\s|$)|[^.!?]+$/g) || [para];
      for (const s of sentences) {
        const trimmed = s.trim();
        if (trimmed) segments.push(trimmed);
      }
    }
  }

  // Greedily merge segments into chunks up to CHUNK_SIZE words
  const chunks: string[] = [];
  let current = "";
  for (const segment of segments) {
    const combined = current ? current + "\n\n" + segment : segment;
    if (wordCount(combined) <= CHUNK_SIZE) {
      current = combined;
    } else {
      // If the current buffer has content, flush it
      if (current) {
        chunks.push(current);
        // Start next chunk with overlap: take trailing sentences from previous chunk
        const overlapText = getOverlapSuffix(current, CHUNK_OVERLAP);
        current = overlapText ? overlapText + "\n\n" + segment : segment;
      } else {
        // Single segment exceeds CHUNK_SIZE — include it as-is
        chunks.push(segment);
        current = "";
      }
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

/** Extract roughly `targetWords` words from the end of text, snapping to sentence boundary. */
function getOverlapSuffix(text: string, targetWords: number): string {
  const sentences = text.match(/[^.!?]*[.!?]+(?:\s|$)|[^.!?]+$/g);
  if (!sentences) return "";

  let result = "";
  // Walk backwards through sentences to build overlap
  for (let i = sentences.length - 1; i >= 0; i--) {
    const candidate = sentences[i].trim() + (result ? " " + result : "");
    if (wordCount(candidate) > targetWords && result) break;
    result = candidate;
  }
  return result;
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
          series: sermon.series || "",
          eventType: sermon.eventType || "",
          keywords: sermon.keywords || "",
          subtitle: sermon.subtitle || "",
          chunkIndex: i,
        },
      });
    }
  }
  return chunks;
}

/** Build the text sent to the embedding model — includes metadata so
 *  queries mentioning a preacher, title, or passage rank correctly. */
function embeddingText(chunk: ChunkRecord): string {
  const m = chunk.metadata;
  const parts = [m.title, m.preacher, m.bibleText, m.preachDate, m.series, m.subtitle, m.keywords];
  const header = parts.filter(Boolean).join(" | ");
  return `${header}\n\n${chunk.text}`;
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

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 429 && attempt < maxRetries) {
        const delay = Math.min(2 ** attempt * 1000, 60000);
        console.log(`\n  Rate limited, waiting ${delay / 1000}s before retry...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);
    const res = await withRetry(() =>
      openai.embeddings.create({ model: EMBEDDING_MODEL, input: batch })
    );
    for (const item of res.data) {
      embeddings.push(item.embedding);
    }
    if (i + EMBEDDING_BATCH_SIZE < texts.length) {
      process.stdout.write(`  Embedded ${Math.min(i + EMBEDDING_BATCH_SIZE, texts.length)}/${texts.length} chunks\r`);
    }
  }
  return embeddings;
}

const DELETE_BATCH_SIZE = 1000;

async function deleteAllVectors(index: ReturnType<Pinecone["index"]>, namespace: string) {
  const ns = namespace ? index.namespace(namespace) : index;
  try {
    // Try deleteAll first (supported on most Pinecone plans)
    await ns.deleteAll();
    console.log("Deleted all existing vectors");
    return;
  } catch {
    // Fall back to paginated delete
  }

  console.log("Deleting existing vectors in batches...");
  const ids = await getExistingIds(index, namespace);
  const allIds = [...ids];
  for (let i = 0; i < allIds.length; i += DELETE_BATCH_SIZE) {
    const batch = allIds.slice(i, i + DELETE_BATCH_SIZE);
    await ns.deleteMany(batch);
    process.stdout.write(`  Deleted ${Math.min(i + DELETE_BATCH_SIZE, allIds.length)}/${allIds.length}\r`);
  }
  console.log(`\nDeleted ${allIds.length} vectors`);
}

async function main() {
  const rebuild = process.argv.includes("--rebuild");
  const indexName = process.env.PINECONE_INDEX || "sermon-transcripts";
  const namespace = process.env.PINECONE_NAMESPACE || "";

  console.log(`Using Pinecone index: ${indexName}${namespace ? `, namespace: ${namespace}` : ""}`);
  if (rebuild) console.log("Rebuild mode: will delete all existing vectors first");

  const index = pinecone.index(indexName);

  // In rebuild mode, clear the index before re-indexing
  if (rebuild) {
    await deleteAllVectors(index, namespace);
  }

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
  const embeddings = await generateEmbeddings(newChunks.map((c) => embeddingText(c)));
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
