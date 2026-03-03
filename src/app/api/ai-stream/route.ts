import { anthropic } from "@ai-sdk/anthropic";
import { deepseek } from "@ai-sdk/deepseek";
import { openai as openaiProvider } from "@ai-sdk/openai";
import { xai } from "@ai-sdk/xai";
import { streamText } from "ai";
import { AI_SYSTEM_PROMPT } from "@/lib/siteConfig";

export type AiProvider = "anthropic" | "deepseek" | "openai" | "xai";

const PROVIDER_MODEL_IDS: Record<AiProvider, string> = {
  anthropic: process.env.AI_SEARCH_MODEL_ANTHROPIC || "claude-haiku-4-5",
  deepseek: process.env.AI_SEARCH_MODEL_DEEPSEEK || "deepseek-chat",
  openai: process.env.AI_SEARCH_MODEL_OPENAI || "gpt-5.2",
  xai: process.env.AI_SEARCH_MODEL_XAI || "grok-4-fast-non-reasoning",
};

const PROVIDER_MODELS: Record<AiProvider, () => ReturnType<typeof anthropic>> = {
  anthropic: () => anthropic(PROVIDER_MODEL_IDS.anthropic),
  deepseek: () => deepseek(PROVIDER_MODEL_IDS.deepseek),
  openai: () => openaiProvider(PROVIDER_MODEL_IDS.openai),
  xai: () => xai(PROVIDER_MODEL_IDS.xai),
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
    rawProvider === "deepseek" || rawProvider === "openai" || rawProvider === "xai" ? rawProvider : "anthropic";

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

  const modelId = PROVIDER_MODEL_IDS[provider];
  console.log(`[ai-agent] ${new Date().toISOString()} | provider=${provider} | model=${modelId} | q="${query}"`);

  const sourcesHeader = encodeURIComponent(JSON.stringify(sources ?? []));

  try {
    const result = streamText({
      model: PROVIDER_MODELS[provider](),
      messages: [
        {
          role: "system",
          content: AI_SYSTEM_PROMPT,
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        },
        {
          role: "user",
          content: `Here are relevant excerpts from sermons:\n\n${context}\n\nUser's question: ${query}`,
        },
      ],
      providerOptions: {
        openai: { promptCacheRetention: "24h" },
      },
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
