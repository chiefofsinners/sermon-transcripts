import { anthropic } from "@ai-sdk/anthropic";
import { deepseek } from "@ai-sdk/deepseek";
import { openai as openaiProvider } from "@ai-sdk/openai";
import { xai } from "@ai-sdk/xai";
import { generateText, streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { embed } from "@/lib/embeddings";
import { AI_SYSTEM_PROMPT, RETRIEVAL_SYSTEM_PROMPT } from "@/lib/siteConfig";

// --- Provider config ---

type AiProvider = "anthropic" | "deepseek" | "openai" | "xai";

const PROVIDER_MODEL_IDS: Record<AiProvider, string> = {
  anthropic: process.env.AI_SEARCH_MODEL_ANTHROPIC || "claude-haiku-4-5",
  deepseek: process.env.AI_SEARCH_MODEL_DEEPSEEK || "deepseek-chat",
  openai: process.env.AI_SEARCH_MODEL_OPENAI || "gpt-5.2",
  xai: process.env.AI_SEARCH_MODEL_XAI || "grok-4-fast-non-reasoning",
};

function getModel(provider: AiProvider) {
  const id = PROVIDER_MODEL_IDS[provider];
  switch (provider) {
    case "anthropic": return anthropic(id);
    case "deepseek": return deepseek(id);
    case "openai": return openaiProvider(id);
    case "xai": return xai(id);
  }
}

// --- Source tracking ---

interface Source {
  sermonID: string;
  title: string;
  preacher: string;
  preachDate: string;
  bibleText: string;
}

// --- Agent tools ---

function createAgentTools(sources: Map<string, Source>) {
  return {
    searchSermons: tool({
      description:
        "Semantic vector search across all sermon transcripts. Use this to find sermon content relevant to a topic, question, or theme. You can optionally filter by preacher, series, bible text, or date range.",
      inputSchema: z.object({
        query: z.string().describe("The search query — what to look for in sermons"),
        preacher: z.string().optional().describe("Filter to a specific preacher name"),
        series: z.string().optional().describe("Filter to a specific series ID"),
        bibleText: z.string().optional().describe("Filter to sermons on a specific Bible passage"),
        dateFrom: z.string().optional().describe("Filter to sermons preached on or after this date (YYYY-MM-DD)"),
        dateTo: z.string().optional().describe("Filter to sermons preached on or before this date (YYYY-MM-DD)"),
        maxResults: z.number().optional().default(20).describe("Maximum number of chunks to return (default 20)"),
      }),
      execute: async ({ query, preacher, series, bibleText, dateFrom, dateTo, maxResults }) => {
        const queryEmbedding = (await embed([query], "query"))[0];

        const { data, error } = await supabase.rpc("search_chunks", {
          query_embedding: JSON.stringify(queryEmbedding),
          match_count: maxResults ?? 20,
          filter_preacher: preacher ?? null,
          filter_series: series ?? null,
          filter_date_from: dateFrom ?? null,
          filter_date_to: dateTo ?? null,
          filter_bible_text: bibleText ?? null,
        });

        if (error) {
          console.error("[ai-search] searchSermons RPC error:", error);
          return { error: error.message };
        }

        const results = (data ?? []).map((row: {
          sermon_id: string;
          title: string;
          preacher: string;
          preach_date: string;
          bible_text: string;
          series: string;
          chunk_index: number;
          chunk_text: string;
          similarity: number;
        }) => {
          // Track source
          if (!sources.has(row.sermon_id)) {
            sources.set(row.sermon_id, {
              sermonID: row.sermon_id,
              title: row.title,
              preacher: row.preacher,
              preachDate: row.preach_date ?? "",
              bibleText: row.bible_text ?? "",
            });
          }
          return {
            sermonID: row.sermon_id,
            title: row.title,
            preacher: row.preacher,
            preachDate: row.preach_date,
            bibleText: row.bible_text,
            series: row.series,
            chunkText: row.chunk_text,
            similarity: row.similarity,
          };
        });

        return results;
      },
    }),

    getSermonTranscript: tool({
      description:
        "Fetch the full transcript of a specific sermon. Use this when you need to read the complete text of a sermon for deep analysis.",
      inputSchema: z.object({
        sermonID: z.string().describe("The sermon ID to fetch"),
      }),
      execute: async ({ sermonID }) => {
        const { data, error } = await supabase
          .from("sermons")
          .select("sermon_id, title, preacher, preach_date, bible_text, series, transcript")
          .eq("sermon_id", sermonID)
          .single();

        if (error || !data) {
          return { error: error?.message ?? "Sermon not found" };
        }

        // Track source
        if (!sources.has(data.sermon_id)) {
          sources.set(data.sermon_id, {
            sermonID: data.sermon_id,
            title: data.title,
            preacher: data.preacher,
            preachDate: data.preach_date ?? "",
            bibleText: data.bible_text ?? "",
          });
        }

        return {
          sermonID: data.sermon_id,
          title: data.title,
          preacher: data.preacher,
          preachDate: data.preach_date,
          bibleText: data.bible_text,
          series: data.series,
          transcript: data.transcript,
        };
      },
    }),

    getSermonChunks: tool({
      description:
        "Fetch specific chunks from a sermon by chunk indices. Useful when you want to read particular sections of a sermon without fetching the full transcript.",
      inputSchema: z.object({
        sermonID: z.string().describe("The sermon ID"),
        chunkIndices: z.array(z.number()).optional().describe("Specific chunk indices to fetch. If omitted, returns all chunks."),
      }),
      execute: async ({ sermonID, chunkIndices }) => {
        let query = supabase
          .from("sermon_chunks")
          .select("chunk_index, text")
          .eq("sermon_id", sermonID)
          .order("chunk_index");

        if (chunkIndices && chunkIndices.length > 0) {
          query = query.in("chunk_index", chunkIndices);
        }

        const { data, error } = await query;

        if (error) {
          return { error: error.message };
        }

        return (data ?? []).map((row: { chunk_index: number; text: string }) => ({
          chunkIndex: row.chunk_index,
          text: row.text,
        }));
      },
    }),

    listSermons: tool({
      description:
        "Search for sermons by metadata (preacher, series, date range) without vector search. Use this when you need to find sermons by a specific preacher, within a date range, or in a particular series.",
      inputSchema: z.object({
        preacher: z.string().optional().describe("Filter by preacher name"),
        series: z.string().optional().describe("Filter by series ID"),
        dateFrom: z.string().optional().describe("Filter sermons on or after this date (YYYY-MM-DD)"),
        dateTo: z.string().optional().describe("Filter sermons on or before this date (YYYY-MM-DD)"),
        limit: z.number().optional().default(50).describe("Maximum results to return (default 50)"),
      }),
      execute: async ({ preacher, series, dateFrom, dateTo, limit }) => {
        const { data, error } = await supabase.rpc("list_sermons", {
          filter_preacher: preacher ?? null,
          filter_series: series ?? null,
          filter_date_from: dateFrom ?? null,
          filter_date_to: dateTo ?? null,
          match_limit: limit ?? 50,
        });

        if (error) {
          console.error("[ai-search] listSermons RPC error:", error);
          return { error: error.message };
        }

        const results = (data ?? []).map((row: {
          sermon_id: string;
          title: string;
          preacher: string;
          preach_date: string;
          bible_text: string;
          series: string;
          event_type: string;
          subtitle: string;
        }) => {
          // Track source
          if (!sources.has(row.sermon_id)) {
            sources.set(row.sermon_id, {
              sermonID: row.sermon_id,
              title: row.title,
              preacher: row.preacher,
              preachDate: row.preach_date ?? "",
              bibleText: row.bible_text ?? "",
            });
          }
          return {
            sermonID: row.sermon_id,
            title: row.title,
            preacher: row.preacher,
            preachDate: row.preach_date,
            bibleText: row.bible_text,
            series: row.series,
            eventType: row.event_type,
            subtitle: row.subtitle,
          };
        });

        return results;
      },
    }),
  };
}

// --- Logging helpers ---

function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "searchSermons": {
      const parts = [`q="${input.query}"`];
      if (input.preacher) parts.push(`preacher="${input.preacher}"`);
      if (input.series) parts.push(`series="${input.series}"`);
      if (input.bibleText) parts.push(`bible="${input.bibleText}"`);
      if (input.maxResults) parts.push(`max=${input.maxResults}`);
      return parts.join(", ");
    }
    case "getSermonTranscript":
      return `id=${input.sermonID}`;
    case "getSermonChunks":
      return `id=${input.sermonID}, chunks=${input.chunkIndices ?? "all"}`;
    case "listSermons": {
      const parts: string[] = [];
      if (input.preacher) parts.push(`preacher="${input.preacher}"`);
      if (input.series) parts.push(`series="${input.series}"`);
      if (input.limit) parts.push(`limit=${input.limit}`);
      return parts.join(", ") || "all";
    }
    default:
      return JSON.stringify(input).slice(0, 100);
  }
}

function describeToolStep(toolName: string, input: Record<string, unknown>, resultCount: number): string {
  switch (toolName) {
    case "searchSermons": {
      const q = String(input.query ?? "").slice(0, 60);
      const filters: string[] = [];
      if (input.preacher) filters.push(`by ${input.preacher}`);
      if (input.bibleText) filters.push(`on ${input.bibleText}`);
      const suffix = filters.length > 0 ? ` ${filters.join(", ")}` : "";
      return `Searched "${q}"${suffix} — found ${resultCount} results`;
    }
    case "getSermonTranscript":
      return `Reading full transcript...`;
    case "getSermonChunks":
      return `Reading sermon sections...`;
    case "listSermons": {
      const parts: string[] = [];
      if (input.preacher) parts.push(`by ${input.preacher}`);
      if (input.series) parts.push(`in series`);
      return `Listing sermons${parts.length ? " " + parts.join(", ") : ""} — found ${resultCount}`;
    }
    default:
      return `Processing...`;
  }
}

// --- Main handler ---

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { query, provider: rawProvider } = body;

  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return new Response(JSON.stringify({ error: "Query is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const provider: AiProvider =
    rawProvider === "deepseek" || rawProvider === "openai" || rawProvider === "xai"
      ? rawProvider
      : "anthropic";

  const modelId = PROVIDER_MODEL_IDS[provider];
  console.log(`[ai-search] ${new Date().toISOString()} | provider=${provider} | model=${modelId} | q="${query}"`);

  // Accumulate sources from all tool calls
  const sources = new Map<string, Source>();
  const tools = createAgentTools(sources);

  // Stream status updates during retrieval, then answer text
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // --- Phase A: Agentic Retrieval ---
        const sendStatus = (msg: string) => {
          controller.enqueue(encoder.encode(`§STATUS:${msg}\n`));
        };

        sendStatus("Searching sermons...");

        const retrievalResult = await generateText({
          model: getModel(provider),
          system: RETRIEVAL_SYSTEM_PROMPT,
          prompt: query,
          tools,
          stopWhen: stepCountIs(10),
          onStepFinish({ toolCalls, toolResults }) {
            if (toolCalls.length > 0) {
              for (let i = 0; i < toolCalls.length; i++) {
                const tc = toolCalls[i];
                const tr = toolResults[i];
                const input = tc.input as Record<string, unknown>;
                const resultCount = Array.isArray(tr?.output) ? tr.output.length : tr?.output ? 1 : 0;
                console.log(
                  `[ai-search] step tool=${tc.toolName} | ${summarizeToolInput(tc.toolName, input)} | results=${resultCount}`
                );
                sendStatus(describeToolStep(tc.toolName, input, resultCount));
              }
            } else {
              console.log(`[ai-search] step (no tool calls — planning/finishing)`);
            }
          },
        });

        console.log(
          `[ai-search] retrieval complete | steps=${retrievalResult.steps.length} | sources=${sources.size} | tool calls: ${
            retrievalResult.steps
              .flatMap((s) => s.toolCalls)
              .map((tc) => tc.toolName)
              .join(", ") || "none"
          }`
        );

        // Collect all chunk text from tool call results for context
        const contextChunks: string[] = [];
        for (const step of retrievalResult.steps) {
          for (const toolResult of step.toolResults) {
            const value = toolResult.output;
            if (Array.isArray(value)) {
              for (const item of value) {
                if (item.chunkText) {
                  contextChunks.push(
                    `[Source: "${item.title}" by ${item.preacher}${item.bibleText ? ` (${item.bibleText})` : ""}${item.preachDate ? `, ${item.preachDate}` : ""}]\n${item.chunkText}`
                  );
                } else if (item.text && item.chunkIndex !== undefined) {
                  contextChunks.push(item.text);
                }
              }
            } else if (value && typeof value === "object" && "transcript" in value) {
              const v = value as { title: string; preacher: string; bibleText?: string; preachDate?: string; transcript: string };
              contextChunks.push(
                `[Source: "${v.title}" by ${v.preacher}${v.bibleText ? ` (${v.bibleText})` : ""}${v.preachDate ? `, ${v.preachDate}` : ""}]\n${v.transcript}`
              );
            }
          }
        }

        if (contextChunks.length === 0 && sources.size === 0) {
          controller.enqueue(encoder.encode(`§ERROR:No relevant sermon content found\n`));
          controller.close();
          return;
        }

        const formattedContext = contextChunks.join("\n\n---\n\n");

        sendStatus(`Found ${sources.size} sermons — generating answer...`);

        // --- Phase B: Streaming Answer ---
        const result = streamText({
          model: getModel(provider),
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
              content: `Here are relevant excerpts from sermons:\n\n${formattedContext}\n\nUser's question: ${query}`,
            },
          ],
          providerOptions: {
            openai: { promptCacheRetention: "24h" },
          },
        });

        // Signal end of status updates, start of answer
        controller.enqueue(encoder.encode("§END_STATUS\n"));

        // Pipe answer stream
        const reader = result.textStream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(encoder.encode(value));
          }
        } finally {
          reader.releaseLock();
        }

        controller.close();
      } catch (err) {
        console.error(`[ai-search] error (${provider}):`, err);
        controller.enqueue(
          encoder.encode(`§ERROR:${err instanceof Error ? err.message : "Unknown error"}\n`)
        );
        controller.close();
      }
    },
  });

  const sourcesArray = Array.from(sources.values());
  const sourcesHeader = encodeURIComponent(JSON.stringify(sourcesArray));

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Sources": sourcesHeader,
    },
  });
}
