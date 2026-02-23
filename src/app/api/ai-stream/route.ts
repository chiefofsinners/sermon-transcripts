import { anthropic } from "@ai-sdk/anthropic";
import { openai as openaiProvider } from "@ai-sdk/openai";
import { xai } from "@ai-sdk/xai";
import { streamText } from "ai";

export type AiProvider = "anthropic" | "openai" | "xai";

const PROVIDER_MODELS: Record<AiProvider, () => ReturnType<typeof anthropic>> = {
  anthropic: () => anthropic(process.env.AI_SEARCH_MODEL_ANTHROPIC || "claude-haiku-4-5"),
  openai: () => openaiProvider(process.env.AI_SEARCH_MODEL_OPENAI || "gpt-5.2"),
  xai: () => xai(process.env.AI_SEARCH_MODEL_XAI || "grok-4-fast-non-reasoning"),
};

interface Source {
  sermonID: string;
  title: string;
  preacher: string;
  preachDate: string;
  bibleText: string;
}

export async function POST(request: Request) {
  const { context, sources, query, provider: rawProvider } = await request.json();
  const provider: AiProvider =
    rawProvider === "openai" || rawProvider === "xai" ? rawProvider : "anthropic";

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return new Response(JSON.stringify({ error: "Query is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!context || typeof context !== "string") {
    return new Response(JSON.stringify({ error: "Context is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const siteName = process.env.NEXT_PUBLIC_SITE_TITLE || "Sermon Transcripts";

  const sourcesHeader = encodeURIComponent(JSON.stringify(sources ?? []));

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
        "X-Sources": sourcesHeader,
      },
    });
  } catch (err) {
    console.error(`[ai-stream] LLM error (${provider}):`, err);
    return new Response(
      JSON.stringify({ error: `LLM request failed: ${err instanceof Error ? err.message : "Unknown error"}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
