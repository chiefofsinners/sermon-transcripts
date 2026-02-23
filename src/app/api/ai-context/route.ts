import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { embed } from "@/lib/embeddings";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });

const AI_UTILITY_MODEL = process.env.AI_UTILITY_MODEL || "gpt-5-nano";

interface ChunkMetadata {
  sermonID: string;
  title: string;
  preacher: string;
  preachDate: string;
  bibleText: string;
  series: string;
  chunkIndex: number;
  text: string;
}

interface ScoredChunk {
  metadata: ChunkMetadata;
  score: number;
}

// --- Budget profiles ---

type QueryScope = "narrow" | "medium" | "broad";

interface BudgetProfile {
  topK: number;
  maxContextChunks: number;
  maxChunksPerSermon: number;
  siblingReserve: number;
  maxSermonsForSeries: number;
}

const BUDGET_PROFILES: Record<QueryScope, BudgetProfile> = {
  narrow: {
    topK: 100,
    maxContextChunks: 80,
    maxChunksPerSermon: 12,
    siblingReserve: 12,
    maxSermonsForSeries: 40,
  },
  medium: {
    topK: 120,
    maxContextChunks: 100,
    maxChunksPerSermon: 16,
    siblingReserve: 20,
    maxSermonsForSeries: 60,
  },
  broad: {
    topK: 150,
    maxContextChunks: 120,
    maxChunksPerSermon: 20,
    siblingReserve: 28,
    maxSermonsForSeries: 100,
  },
};

// --- Query expansion ---

async function expandQuery(query: string): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: AI_UTILITY_MODEL,
      max_completion_tokens: 1024,
      reasoning_effort: "low",
      messages: [
        {
          role: "system",
          content: `You are a search query expander for a Reformed Christian sermon library. Given a user's search query, rewrite it as a single dense paragraph that includes the original query plus synonyms, related theological terms, and subtopics that a preacher might address under this heading.

For example, "sixth commandment" should also mention: thou shalt not kill, murder, killing, manslaughter, suicide, self-harm, abortion, euthanasia, capital punishment, sanctity of life, bloodshed, taking life, preservation of life.

Keep the original query terms. Add related terms naturally. Do not explain — just output the expanded query.`,
        },
        { role: "user", content: query },
      ],
    });

    const expanded = response.choices[0]?.message?.content?.trim();
    if (expanded) {
      console.log(`[ai-context] expanded query: "${expanded.slice(0, 120)}…"`);
      return expanded;
    }
    return query;
  } catch (err) {
    console.error("[ai-context] expandQuery error, using original:", err);
    return query;
  }
}

// --- Query classification ---

async function classifyQuery(query: string): Promise<QueryScope> {
  try {
    const response = await openai.chat.completions.create({
      model: AI_UTILITY_MODEL,
      max_completion_tokens: 256,
      reasoning_effort: "low",
      messages: [
        {
          role: "system",
          content: `Classify the user's sermon search query into exactly one category. Reply with a single word: narrow, medium, or broad.

narrow = a specific single sermon, a specific passage/quote, or a very focused preacher+topic question expecting one or two sermons
medium = a theme or doctrine across several sermons, a preacher's teaching on a topic, summarising a series, or a preacher's general teaching
broad = comparative across many sermons or multiple preachers, sweeping themes, "everything about X", or questions spanning the whole library`,
        },
        { role: "user", content: query },
      ],
    });

    const raw = response.choices[0]?.message?.content?.trim().toLowerCase();
    if (raw === "narrow" || raw === "medium" || raw === "broad") return raw;
    console.log(`[ai-context] classifyQuery: unexpected response "${raw}", defaulting to medium`);
    return "medium";
  } catch (err) {
    console.error("[ai-context] classifyQuery error, defaulting to medium:", err);
    return "medium";
  }
}

// --- Adaptive cutoff ---

function findAdaptiveCutoff(scores: number[], maxContextChunks: number): number {
  const minKeep = Math.max(8, Math.ceil(maxContextChunks * 0.3));
  if (scores.length <= minKeep) return scores.length;

  const GAP_THRESHOLD = 0.03;
  let largestGap = 0;
  let cutIndex = scores.length;

  // Scores are in descending order. Scan for the largest gap beyond minKeep.
  for (let i = minKeep; i < scores.length; i++) {
    const gap = scores[i - 1] - scores[i];
    if (gap > largestGap && gap >= GAP_THRESHOLD) {
      largestGap = gap;
      cutIndex = i;
    }
  }

  return cutIndex;
}

// --- Main handler ---

export interface AiContextResponse {
  context: string;
  sources: { sermonID: string; title: string; preacher: string; preachDate: string; bibleText: string }[];
  scope: QueryScope;
}

export async function POST(request: Request) {
  const { query } = await request.json();

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return new Response(JSON.stringify({ error: "Query is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const indexName = process.env.PINECONE_INDEX || "sermon-transcripts";
  const namespace = process.env.PINECONE_NAMESPACE || "";
  const index = pinecone.index(indexName);

  // 1. Classify query and expand it (runs in parallel)
  const [scope, expandedQuery] = await Promise.all([
    classifyQuery(query.trim()),
    expandQuery(query.trim()),
  ]);

  const budget = BUDGET_PROFILES[scope];

  // 2. Embed the expanded query
  const [queryEmbedding] = await embed([expandedQuery], "query");

  // 3. Query Pinecone with budget-driven topK
  const ns = namespace ? index.namespace(namespace) : index;
  const results = await ns.query({
    vector: queryEmbedding,
    topK: budget.topK,
    includeMetadata: true,
  });

  // 4. Preserve scores alongside metadata
  const allScoredChunks: ScoredChunk[] = (results.matches ?? [])
    .filter((m) => m.metadata && typeof m.score === "number")
    .map((m) => ({
      metadata: m.metadata as unknown as ChunkMetadata,
      score: m.score!,
    }));

  // 5. Adaptive gap cutoff — find natural cluster boundary
  const scores = allScoredChunks.map((c) => c.score);
  const adaptiveCutoff = findAdaptiveCutoff(scores, budget.maxContextChunks);
  const qualityChunks = allScoredChunks.slice(0, adaptiveCutoff);

  // Diagnostic logging
  console.log(
    `[ai-context] scope=${scope} | topK=${budget.topK} | raw=${allScoredChunks.length} | after adaptive cutoff=${qualityChunks.length} | score range=${
      allScoredChunks.length > 0
        ? `${allScoredChunks[0].score.toFixed(3)}–${allScoredChunks[allScoredChunks.length - 1].score.toFixed(3)}`
        : "n/a"
    }`
  );

  // 6. Series expansion — collect series IDs from top-ranked results
  const topSeriesIDs = new Set<string>();
  const seenSermons = new Set<string>();
  for (const { metadata: chunk } of qualityChunks) {
    if (!seenSermons.has(chunk.sermonID)) {
      seenSermons.add(chunk.sermonID);
      if (chunk.series) topSeriesIDs.add(chunk.series);
      if (seenSermons.size >= budget.maxSermonsForSeries) break;
    }
  }

  // For each top series, query Pinecone for sibling sermons not in initial results
  const MAX_SIBLING_CHUNKS_PER_SERMON = 3;
  const siblingsBySermon = new Map<string, ChunkMetadata[]>();
  const allMatchedSermonIDs = new Set(qualityChunks.map((c) => c.metadata.sermonID));

  for (const seriesID of topSeriesIDs) {
    const seriesResults = await ns.query({
      vector: queryEmbedding,
      topK: budget.topK,
      includeMetadata: true,
      filter: { series: { $eq: seriesID } },
    });
    for (const m of seriesResults.matches ?? []) {
      if (!m.metadata) continue;
      const chunk = m.metadata as unknown as ChunkMetadata;
      if (allMatchedSermonIDs.has(chunk.sermonID)) continue;
      const existing = siblingsBySermon.get(chunk.sermonID) ?? [];
      if (existing.length >= MAX_SIBLING_CHUNKS_PER_SERMON) continue;
      existing.push(chunk);
      siblingsBySermon.set(chunk.sermonID, existing);
    }
  }

  const seriesSiblingChunks = [...siblingsBySermon.values()].flat();

  // Reserve slots for series siblings, then fill the rest from initial results
  const siblingReserved = Math.min(seriesSiblingChunks.length, budget.siblingReserve);
  const mainBudget = budget.maxContextChunks - siblingReserved;

  const sermonChunkCounts = new Map<string, number>();
  const chunks: ChunkMetadata[] = [];

  // Fill main budget from quality-filtered results
  for (const { metadata: chunk } of qualityChunks) {
    if (chunks.length >= mainBudget) break;
    const count = sermonChunkCounts.get(chunk.sermonID) ?? 0;
    if (count >= budget.maxChunksPerSermon) continue;
    sermonChunkCounts.set(chunk.sermonID, count + 1);
    chunks.push(chunk);
  }

  // Add series sibling chunks into remaining slots
  for (const chunk of seriesSiblingChunks) {
    if (chunks.length >= budget.maxContextChunks) break;
    const count = sermonChunkCounts.get(chunk.sermonID) ?? 0;
    if (count >= budget.maxChunksPerSermon) continue;
    sermonChunkCounts.set(chunk.sermonID, count + 1);
    chunks.push(chunk);
  }

  console.log(
    `[ai-context] final chunks=${chunks.length} (main=${Math.min(chunks.length, mainBudget)}, siblings=${Math.max(0, chunks.length - mainBudget)}) | sermons=${sermonChunkCounts.size}`
  );

  if (chunks.length === 0) {
    return new Response(
      JSON.stringify({ error: "No relevant sermon content found" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // 7. Deduplicate sources for citation
  const sourceMap = new Map<string, { title: string; preacher: string; preachDate: string; bibleText: string }>();
  for (const chunk of chunks) {
    if (!sourceMap.has(chunk.sermonID)) {
      sourceMap.set(chunk.sermonID, {
        title: chunk.title,
        preacher: chunk.preacher,
        preachDate: chunk.preachDate,
        bibleText: chunk.bibleText,
      });
    }
  }

  // 8. Build context
  const context = chunks
    .map(
      (c, i) =>
        `[Source ${i + 1}: "${c.title}" by ${c.preacher}${c.bibleText ? ` (${c.bibleText})` : ""}${c.preachDate ? `, ${c.preachDate}` : ""}]\n${c.text}`
    )
    .join("\n\n---\n\n");

  const sources = Array.from(sourceMap.entries()).map(([id, s]) => ({
    sermonID: id,
    title: s.title,
    preacher: s.preacher,
    preachDate: s.preachDate,
    bibleText: s.bibleText,
  }));

  const payload: AiContextResponse = { context, sources, scope };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
