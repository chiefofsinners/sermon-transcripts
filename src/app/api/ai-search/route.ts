import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai as openaiProvider } from "@ai-sdk/openai";
import { xai } from "@ai-sdk/xai";
import { streamText, type LanguageModel } from "ai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });

const EMBEDDING_MODEL = "text-embedding-3-small";
const TOP_K = 10;

export type AiProvider = "anthropic" | "openai" | "xai";

const PROVIDER_MODELS: Record<AiProvider, () => LanguageModel> = {
  anthropic: () => anthropic("claude-sonnet-4-20250514"),
  openai: () => openaiProvider("gpt-4o"),
  xai: () => xai("grok-3"),
};

interface ChunkMetadata {
  sermonID: string;
  title: string;
  preacher: string;
  preachDate: string;
  bibleText: string;
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

  const chunks = (results.matches ?? [])
    .filter((m) => m.metadata)
    .map((m) => m.metadata as unknown as ChunkMetadata);

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
  const result = streamText({
    model: PROVIDER_MODELS[provider](),
    system: `You are a helpful assistant that answers questions about sermons from ${siteName}. Use ONLY the provided sermon excerpts to answer the user's question. If the excerpts don't contain relevant information, say so honestly.

When referencing a sermon, cite it inline using the format [Sermon Title, Preacher] — these will be linked automatically. Be concise but thorough. Use markdown formatting where helpful.

After your answer, output a line containing exactly "---SOURCES---" followed by this JSON on a new line:
${JSON.stringify(sources)}`,
    prompt: `Here are relevant excerpts from sermons:\n\n${context}\n\nUser's question: ${query}`,
  });

  return result.toDataStreamResponse();
}
