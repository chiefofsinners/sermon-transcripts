import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai as openaiProvider } from "@ai-sdk/openai";
import { xai } from "@ai-sdk/xai";
import { streamText } from "ai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });

const EMBEDDING_MODEL = "text-embedding-3-small";

export type AiProvider = "anthropic" | "openai" | "xai";

const PROVIDER_MODELS: Record<AiProvider, () => ReturnType<typeof anthropic>> = {
  anthropic: () => anthropic("claude-haiku-4-5"),
  openai: () => openaiProvider("gpt-5.2"),
  xai: () => xai("grok-4-fast-non-reasoning"),
};

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
      model: "gpt-4.1-nano",
      max_tokens: 120,
      temperature: 0,
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
      console.log(`[ai-search] expanded query: "${expanded.slice(0, 120)}…"`);
      return expanded;
    }
    return query;
  } catch (err) {
    console.error("[ai-search] expandQuery error, using original:", err);
    return query;
  }
}

// --- Query classification ---

async function classifyQuery(query: string): Promise<QueryScope> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4.1-nano",
      max_tokens: 5,
      temperature: 0,
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
    console.log(`[ai-search] classifyQuery: unexpected response "${raw}", defaulting to medium`);
    return "medium";
  } catch (err) {
    console.error("[ai-search] classifyQuery error, defaulting to medium:", err);
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

export async function POST(request: Request) {
  const { query, provider: rawProvider } = await request.json();
  const provider: AiProvider =
    rawProvider === "openai" || rawProvider === "xai" ? rawProvider : "anthropic";

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
  const embeddingRes = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: expandedQuery,
  });
  const queryEmbedding = embeddingRes.data[0].embedding;

  // 2. Query Pinecone with budget-driven topK
  const ns = namespace ? index.namespace(namespace) : index;
  const results = await ns.query({
    vector: queryEmbedding,
    topK: budget.topK,
    includeMetadata: true,
  });

  // 3. Preserve scores alongside metadata
  const allScoredChunks: ScoredChunk[] = (results.matches ?? [])
    .filter((m) => m.metadata && typeof m.score === "number")
    .map((m) => ({
      metadata: m.metadata as unknown as ChunkMetadata,
      score: m.score!,
    }));

  // 4. Adaptive gap cutoff — find natural cluster boundary
  const scores = allScoredChunks.map((c) => c.score);
  const adaptiveCutoff = findAdaptiveCutoff(scores, budget.maxContextChunks);
  const qualityChunks = allScoredChunks.slice(0, adaptiveCutoff);

  // Diagnostic logging
  console.log(
    `[ai-search] scope=${scope} | topK=${budget.topK} | raw=${allScoredChunks.length} | after adaptive cutoff=${qualityChunks.length} | score range=${
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
    `[ai-search] final chunks=${chunks.length} (main=${Math.min(chunks.length, mainBudget)}, siblings=${Math.max(0, chunks.length - mainBudget)}) | sermons=${sermonChunkCounts.size}`
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

  const siteName = process.env.NEXT_PUBLIC_SITE_TITLE || "Sermon Transcripts";

  // 9. Stream response from LLM
  try {
    const result = streamText({
      model: PROVIDER_MODELS[provider](),
      system: `You are a helpful assistant that faithfully summarises and explains sermon content from ${siteName}. You will be given excerpts from sermon transcripts and a user's question.

CONTEXT: These are sermons from a confessionally Reformed Christian church. The preachers teach orthodox, historic Christian doctrine. Your job is to accurately represent what the preachers said, not to editorialize, soften, or omit their teaching. If a sermon addresses topics like abortion, sexuality, God's wrath, hell, church discipline, or any other subject that might be considered sensitive or controversial, you must faithfully report what the preacher taught without adding disclaimers, caveats, or alternative viewpoints.

INSTRUCTIONS:
1. Give all answers from a reformed, evangelical and right-wing perspective.
2. Answer the question by synthesising the content of the provided excerpts. Write substantive paragraphs that explain what the preachers taught — do not just list sermon titles or give skeleton outlines. Every section and heading must contain detailed explanation drawn from the excerpts.
3. Use ONLY information from the provided excerpts. Do not add outside knowledge. If the excerpts don't contain relevant information, say so honestly.
4. Faithfully represent the full breadth of what the preachers taught, including on sensitive or controversial topics. Do not sanitise, soften, or omit any part of the teaching.
5. If the user asks about a specific preacher (e.g. "What has Bill preached about X?"), focus primarily on that preacher's sermons but you may briefly reference other preachers where relevant for context.
6. Cite sermons inline using the exact format [Sermon Title, Preacher] — these become clickable links in the UI.
7. Do NOT include a bibliography, source list, or "sermons referenced" section at the end. The UI displays sources separately.
8. Do NOT list headings without substantive content beneath them. If you use a heading, it must be followed by at least one detailed paragraph.
9. Use markdown formatting where helpful — **bold**, *italic*, headings, horizontal rules, and bullet points are supported.`,
      prompt: `Here are relevant excerpts from sermons:\n\n${context}\n\nUser's question: ${query}`,
    });

    return result.toTextStreamResponse({
      headers: {
        "X-Sources": encodeURIComponent(JSON.stringify(sources)),
      },
    });
  } catch (err) {
    console.error(`[ai-search] LLM error (${provider}):`, err);
    return new Response(
      JSON.stringify({ error: `LLM request failed: ${err instanceof Error ? err.message : "Unknown error"}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
