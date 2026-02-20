import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai as openaiProvider } from "@ai-sdk/openai";
import { xai } from "@ai-sdk/xai";
import { streamText } from "ai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });

const EMBEDDING_MODEL = "text-embedding-3-small";
const TOP_K = 80;
const MAX_CHUNKS_PER_SERMON = 6; // Cap per sermon so one doesn't dominate
const MAX_CONTEXT_CHUNKS = 40; // Total chunks sent to the LLM

export type AiProvider = "anthropic" | "openai" | "xai";

const PROVIDER_MODELS: Record<AiProvider, () => ReturnType<typeof anthropic>> = {
  anthropic: () => anthropic("claude-sonnet-4-6"),
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

  // 1. Embed the query
  const embeddingRes = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: query.trim(),
  });
  const queryEmbedding = embeddingRes.data[0].embedding;

  // 2. Query Pinecone
  const ns = namespace ? index.namespace(namespace) : index;
  const results = await ns.query({
    vector: queryEmbedding,
    topK: TOP_K,
    includeMetadata: true,
  });

  const allChunks = (results.matches ?? [])
    .filter((m) => m.metadata)
    .map((m) => m.metadata as unknown as ChunkMetadata);

  // Collect series IDs from the top-ranked initial results only (first
  // few sermons), so we focus on series the query is actually about
  // rather than every series that happens to appear in 80 chunks.
  const topSeriesIDs = new Set<string>();
  const seenSermons = new Set<string>();
  const MAX_SERMONS_FOR_SERIES = 5;
  for (const chunk of allChunks) {
    if (!seenSermons.has(chunk.sermonID)) {
      seenSermons.add(chunk.sermonID);
      if (chunk.series) topSeriesIDs.add(chunk.series);
      if (seenSermons.size >= MAX_SERMONS_FOR_SERIES) break;
    }
  }

  // For each top series, query Pinecone for sibling sermons that weren't
  // in the initial results. Build a map of sermonID -> chunks so we can
  // interleave them with the initial results.
  const MAX_SIBLING_CHUNKS_PER_SERMON = 3;
  const siblingsBySermon = new Map<string, ChunkMetadata[]>();
  const allMatchedSermonIDs = new Set(allChunks.map((c) => c.sermonID));

  for (const seriesID of topSeriesIDs) {
    const seriesResults = await ns.query({
      vector: queryEmbedding,
      topK: TOP_K,
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

  // Reserve slots for series siblings, then fill the rest from initial results.
  const SIBLING_RESERVED = Math.min(seriesSiblingChunks.length, 12);
  const mainBudget = MAX_CONTEXT_CHUNKS - SIBLING_RESERVED;

  const sermonChunkCounts = new Map<string, number>();
  const chunks: ChunkMetadata[] = [];

  // Fill main budget from initial results
  for (const chunk of allChunks) {
    if (chunks.length >= mainBudget) break;
    const count = sermonChunkCounts.get(chunk.sermonID) ?? 0;
    if (count >= MAX_CHUNKS_PER_SERMON) continue;
    sermonChunkCounts.set(chunk.sermonID, count + 1);
    chunks.push(chunk);
  }

  // Add series sibling chunks into remaining slots
  for (const chunk of seriesSiblingChunks) {
    if (chunks.length >= MAX_CONTEXT_CHUNKS) break;
    const count = sermonChunkCounts.get(chunk.sermonID) ?? 0;
    if (count >= MAX_CHUNKS_PER_SERMON) continue;
    sermonChunkCounts.set(chunk.sermonID, count + 1);
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return new Response(
      JSON.stringify({ error: "No relevant sermon content found" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // 3. Deduplicate sources for citation
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

  // 4. Build context
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

  // 5. Stream response from LLM
  try {
    const result = streamText({
      model: PROVIDER_MODELS[provider](),
      system: `You are a helpful assistant that faithfully summarises and explains sermon content from ${siteName}. You will be given excerpts from sermon transcripts and a user's question.

CONTEXT: These are sermons from a confessionally Reformed Christian church. The preachers teach orthodox, historic Christian doctrine. Your job is to accurately represent what the preachers said, not to editorialize, soften, or omit their teaching. If a sermon addresses topics like abortion, sexuality, God's wrath, hell, church discipline, or any other subject that might be considered sensitive or controversial, you must faithfully report what the preacher taught without adding disclaimers, caveats, or alternative viewpoints. The user is seeking to understand the content of these sermons, not a balanced secular perspective.

INSTRUCTIONS:
1. Answer the question by synthesising the content of the provided excerpts. Write substantive paragraphs that explain what the preachers taught — do not just list sermon titles or give skeleton outlines. Every section and heading must contain detailed explanation drawn from the excerpts.
2. Use ONLY information from the provided excerpts. Do not add outside knowledge. If the excerpts don't contain relevant information, say so honestly.
3. Faithfully represent the full breadth of what the preachers taught, including on sensitive or controversial topics. Do not sanitise, soften, or omit any part of the teaching.
4. If the user asks about a specific preacher (e.g. "What has Bill preached about X?"), focus primarily on that preacher's sermons but you may briefly reference other preachers where relevant for context.
5. Cite sermons inline using the exact format [Sermon Title, Preacher] — these become clickable links in the UI.
6. Do NOT include a bibliography, source list, or "sermons referenced" section at the end. The UI displays sources separately.
7. Do NOT list headings without substantive content beneath them. If you use a heading, it must be followed by at least one detailed paragraph.
8. Use markdown formatting where helpful — **bold**, *italic*, headings, horizontal rules, and bullet points are supported.`,
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
