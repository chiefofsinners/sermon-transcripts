import { anthropic } from "@ai-sdk/anthropic";
import { deepseek } from "@ai-sdk/deepseek";
import { google } from "@ai-sdk/google";
import { openai as openaiProvider } from "@ai-sdk/openai";
import { xai } from "@ai-sdk/xai";
import { generateText, streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { embed } from "@/lib/embeddings";
import { AI_SYSTEM_PROMPT, RETRIEVAL_SYSTEM_PROMPT } from "@/lib/siteConfig";

// --- Provider config ---

type AiProvider = "anthropic" | "deepseek" | "google" | "openai" | "xai";

/** How many unread-but-newer sermons the backstop will fetch (see Phase A). */
const MAX_BACKSTOP_TRANSCRIPTS = 2;

const PROVIDER_MODEL_IDS: Record<AiProvider, string> = {
  anthropic: process.env.AI_SEARCH_MODEL_ANTHROPIC || "claude-haiku-4-5",
  deepseek: process.env.AI_SEARCH_MODEL_DEEPSEEK || "deepseek-v4-flash",
  google: process.env.AI_SEARCH_MODEL_GOOGLE || "gemini-3.5-flash",
  openai: process.env.AI_SEARCH_MODEL_OPENAI || "gpt-5.5",
  xai: process.env.AI_SEARCH_MODEL_XAI || "grok-4.20",
};

function getModel(provider: AiProvider) {
  const id = PROVIDER_MODEL_IDS[provider];
  switch (provider) {
    case "anthropic": return anthropic(id);
    case "deepseek": return deepseek(id);
    case "google": return google(id);
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

// --- Retrieval filters ---

type FilterKey =
  | "filter_preacher"
  | "filter_series"
  | "filter_date_from"
  | "filter_date_to"
  | "filter_bible_text";

const FILTER_LABELS: Record<FilterKey, string> = {
  filter_preacher: "preacher",
  filter_series: "series",
  filter_date_from: "dateFrom",
  filter_date_to: "dateTo",
  filter_bible_text: "bibleText",
};

interface SearchChunkRow {
  sermon_id: string;
  title: string;
  preacher: string;
  preach_date: string;
  bible_text: string;
  series: string;
  series_name: string | null;
  chunk_index: number;
  chunk_text: string;
  similarity: number;
}

// --- Agent tools ---

function createAgentTools(sources: Map<string, Source>) {
  return {
    searchSermons: tool({
      description:
        "Semantic vector search across all sermon transcripts. Use this to find sermon content relevant to a topic, question, or theme. You can optionally filter by preacher, series, bible text, or date range — but filters are combined with AND, so only pass ones the user actually asked for. Ranks by meaning only: it cannot find 'the most recent' sermon, use listSermons for that.",
      inputSchema: z.object({
        query: z.string().describe("The search query — what to look for in sermons"),
        preacher: z.string().optional().describe("Filter to a specific preacher name"),
        series: z.string().optional().describe("Filter by series ID or series name (e.g. 'Isaiah' will match 'Isaiah Series'). Many sermons belong to no series, so only pass this when the user named a series."),
        bibleText: z.string().optional().describe("Filter to sermons on a specific Bible passage"),
        dateFrom: z.string().optional().describe("Filter to sermons preached on or after this date (YYYY-MM-DD)"),
        dateTo: z.string().optional().describe("Filter to sermons preached on or before this date (YYYY-MM-DD)"),
        maxResults: z.number().optional().default(50).describe("Maximum number of chunks to return (default 50)"),
      }),
      execute: async ({ query, preacher, series, bibleText, dateFrom, dateTo, maxResults }) => {
        const queryEmbedding = (await embed([query], "query"))[0];

        const filters: Record<FilterKey, string | null> = {
          filter_preacher: preacher ?? null,
          filter_series: series ?? null,
          filter_date_from: dateFrom ?? null,
          filter_date_to: dateTo ?? null,
          filter_bible_text: bibleText ?? null,
        };

        // Filters are ANDed in SQL, so a single speculative one zeroes out an
        // otherwise good search — and the agent reads an empty result as "no
        // such sermon exists" rather than "my filter was wrong". So on an empty
        // result, drop filters one at a time and retry. `series` goes first
        // because it is the least reliable: the model tends to guess a series
        // from the question, and plenty of sermons belong to no series at all.
        const RELAXATION_ORDER: FilterKey[] = [
          "filter_series",
          "filter_bible_text",
          "filter_date_from",
          "filter_date_to",
          "filter_preacher",
        ];

        const active = { ...filters };
        const dropped: string[] = [];
        let data: SearchChunkRow[] | null = null;

        for (;;) {
          const res = await supabase.rpc("search_chunks", {
            query_embedding: JSON.stringify(queryEmbedding),
            match_count: maxResults ?? 20,
            ...active,
          });

          if (res.error) {
            console.error("[ai-search] searchSermons RPC error:", res.error);
            return { error: res.error.message };
          }

          data = (res.data ?? []) as SearchChunkRow[];
          if (data.length > 0) break;

          const next = RELAXATION_ORDER.find((k) => active[k] !== null);
          if (!next) break;
          active[next] = null;
          dropped.push(FILTER_LABELS[next]);
        }

        if (dropped.length > 0) {
          console.log(
            `[ai-search] searchSermons relaxed filters: ${dropped.join(", ")} | results=${data.length}`
          );
        }

        const results = (data ?? []).map((row) => {
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
            series: row.series_name ?? row.series,
            chunkText: row.chunk_text,
            similarity: row.similarity,
          };
        });

        return {
          results,
          ...(dropped.length > 0
            ? {
                droppedFilters: dropped,
                note: `No chunks matched with the ${dropped.join(" and ")} filter${dropped.length > 1 ? "s" : ""} applied, so ${dropped.length > 1 ? "they were" : "it was"} dropped and the search re-run. These results are NOT restricted by ${dropped.join(" or ")} — check each result before relying on it.`,
              }
            : {}),
        };
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
        // Fetch the sermon's metadata alongside the chunks: it registers the
        // sermon as a source (so it shows in the UI's source list) and lets
        // each chunk carry its own attribution into the answer context.
        const { data: sermon, error: sermonError } = await supabase
          .from("sermons")
          .select("sermon_id, title, preacher, preach_date, bible_text")
          .eq("sermon_id", sermonID)
          .single();

        if (sermonError || !sermon) {
          return { error: sermonError?.message ?? "Sermon not found" };
        }

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

        if (!sources.has(sermon.sermon_id)) {
          sources.set(sermon.sermon_id, {
            sermonID: sermon.sermon_id,
            title: sermon.title,
            preacher: sermon.preacher,
            preachDate: sermon.preach_date ?? "",
            bibleText: sermon.bible_text ?? "",
          });
        }

        return (data ?? []).map((row: { chunk_index: number; text: string }) => ({
          sermonID: sermon.sermon_id,
          title: sermon.title,
          preacher: sermon.preacher,
          preachDate: sermon.preach_date,
          bibleText: sermon.bible_text,
          chunkIndex: row.chunk_index,
          chunkText: row.text,
        }));
      },
    }),

    listSermons: tool({
      description:
        "Search for sermons by metadata (preacher, series, date range) without vector search. Results are ordered newest first, so this is the ONLY reliable way to answer questions about recent, latest, or most recent sermons. Returns titles and dates only — follow up with getSermonTranscript or getSermonChunks on the sermons you intend to discuss, or their content will not reach the answer.",
      inputSchema: z.object({
        preacher: z.string().optional().describe("Filter by preacher name"),
        series: z.string().optional().describe("Filter by series ID or series name (e.g. 'Isaiah' will match 'Isaiah Series'). Many sermons belong to no series, so only pass this when the user named a series."),
        dateFrom: z.string().optional().describe("Filter sermons on or after this date (YYYY-MM-DD)"),
        dateTo: z.string().optional().describe("Filter sermons on or before this date (YYYY-MM-DD)"),
        limit: z.number().optional().default(100).describe("Maximum results to return (default 100)"),
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

        // listSermons is metadata-only — don't track as sources.
        // Sources are only added when actual content (chunks/transcripts) is retrieved.
        return (data ?? []).map((row: {
          sermon_id: string;
          title: string;
          preacher: string;
          preach_date: string;
          bible_text: string;
          series: string;
          series_name: string | null;
          event_type: string;
          subtitle: string;
        }) => ({
          sermonID: row.sermon_id,
          title: row.title,
          preacher: row.preacher,
          preachDate: row.preach_date,
          bibleText: row.bible_text,
          series: row.series_name ?? row.series,
          eventType: row.event_type,
          subtitle: row.subtitle,
        }));
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

/**
 * Tool results arrive either as a bare array of rows or, for searchSermons,
 * as `{ results, droppedFilters?, note? }`. Normalise to the rows.
 */
function toolResultRows(
  value: unknown
): Record<string, string | number | undefined>[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as { results?: unknown }).results)) {
    return (value as { results: Record<string, string | number | undefined>[] }).results;
  }
  return null;
}

function describeToolStep(
  toolName: string,
  input: Record<string, unknown>,
  resultCount: number,
  droppedFilters?: string[]
): string {
  switch (toolName) {
    case "searchSermons": {
      const q = String(input.query ?? "").slice(0, 60);
      const filters: string[] = [];
      if (input.preacher) filters.push(`by ${input.preacher}`);
      if (input.bibleText) filters.push(`on ${input.bibleText}`);
      if (input.series) filters.push(`in ${input.series}`);
      const suffix = filters.length > 0 ? ` ${filters.join(", ")}` : "";
      if (droppedFilters && droppedFilters.length > 0) {
        return `Searched "${q}"${suffix} — no matches, so widened the search (dropped ${droppedFilters.join(", ")}) and found ${resultCount} results`;
      }
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
    rawProvider === "deepseek" || rawProvider === "google" || rawProvider === "openai" || rawProvider === "xai"
      ? rawProvider
      : "anthropic";

  // Retrieval model: defaults to Anthropic (fast tool use), configurable via env
  const retrievalProvider = (process.env.AI_RETRIEVAL_PROVIDER || "anthropic") as AiProvider;
  const retrievalModel = getModel(retrievalProvider);
  const answerModel = getModel(provider);

  const modelId = PROVIDER_MODEL_IDS[provider];
  console.log(`[ai-search] ${new Date().toISOString()} | provider=${provider} | model=${modelId} | retrieval=${retrievalProvider} | q="${query}"`);

  // Accumulate sources from all tool calls
  const sources = new Map<string, Source>();
  const tools = createAgentTools(sources);

  // Stream status updates during retrieval, then answer text
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let controllerClosed = false;
      try {
        // --- Phase A: Agentic Retrieval ---
        const sendStatus = (msg: string) => {
          if (controllerClosed) return;
          try {
            controller.enqueue(encoder.encode(`§STATUS:${msg}\n`));
          } catch {
            controllerClosed = true;
          }
        };

        sendStatus("Searching sermons...");

        const retrievalResult = await generateText({
          model: retrievalModel,
          system: RETRIEVAL_SYSTEM_PROMPT,
          prompt: query,
          tools,
          stopWhen: stepCountIs(25),
          prepareStep({ stepNumber }) {
            // Force a searchSermons call on the first step to guarantee we always retrieve content
            if (stepNumber === 0) {
              return { toolChoice: { type: "tool", toolName: "searchSermons" } };
            }
            return {};
          },
          onStepFinish({ toolCalls, toolResults }) {
            if (toolCalls.length > 0) {
              for (let i = 0; i < toolCalls.length; i++) {
                const tc = toolCalls[i];
                const tr = toolResults[i];
                const input = tc.input as Record<string, unknown>;
                const rows = toolResultRows(tr?.output);
                const resultCount = rows ? rows.length : tr?.output ? 1 : 0;
                const droppedFilters = (tr?.output as { droppedFilters?: string[] } | undefined)?.droppedFilters;
                console.log(
                  `[ai-search] step tool=${tc.toolName} | ${summarizeToolInput(tc.toolName, input)} | results=${resultCount}${droppedFilters ? ` | dropped=${droppedFilters.join(",")}` : ""}`
                );
                sendStatus(describeToolStep(tc.toolName, input, resultCount, droppedFilters));
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
        // Sermons we actually hold text for, and every sermon the catalogue
        // said exists — compared below to catch a sermon the agent listed but
        // never read.
        const contentSermonIds = new Set<string>();
        const catalogueEntries = new Map<string, string>();
        for (const step of retrievalResult.steps) {
          for (const toolResult of step.toolResults) {
            const value = toolResult.output;
            const rows = toolResultRows(value);
            if (toolResult.toolName === "listSermons" && rows && rows.length > 0) {
              // Metadata only — no transcript text. It still belongs in the
              // context: without it the answer model cannot know a sermon
              // exists at all, which is how a newly added sermon goes missing
              // from "what was preached recently?".
              for (const r of rows) {
                if (typeof r.sermonID === "string" && typeof r.preachDate === "string") {
                  catalogueEntries.set(r.sermonID, r.preachDate);
                }
              }
              const listing = rows
                .map(
                  (r) =>
                    `- ${r.preachDate ?? "undated"} — "${r.title}" by ${r.preacher}${r.bibleText ? ` (${r.bibleText})` : ""}`
                )
                .join("\n");
              contextChunks.push(
                `[Sermon catalogue — titles and dates only, newest first. These sermons exist and may be referred to by title, date, preacher and passage, but no transcript text was retrieved for them, so do not describe their content.]\n${listing}`
              );
            } else if (rows) {
              for (const item of rows) {
                if (item.chunkText) {
                  if (typeof item.sermonID === "string") contentSermonIds.add(item.sermonID);
                  contextChunks.push(
                    `[Source: "${item.title}" by ${item.preacher}${item.bibleText ? ` (${item.bibleText})` : ""}${item.preachDate ? `, ${item.preachDate}` : ""}]\n${item.chunkText}`
                  );
                }
              }
            } else if (value && typeof value === "object" && "transcript" in value) {
              const v = value as { sermonID?: string; title: string; preacher: string; bibleText?: string; preachDate?: string; transcript: string };
              if (v.sermonID) contentSermonIds.add(v.sermonID);
              contextChunks.push(
                `[Source: "${v.title}" by ${v.preacher}${v.bibleText ? ` (${v.bibleText})` : ""}${v.preachDate ? `, ${v.preachDate}` : ""}]\n${v.transcript}`
              );
            }
          }
        }

        // Backstop: the agent sometimes lists a sermon and then answers without
        // reading it, which is how the newest sermon ends up acknowledged but
        // undescribed ("the transcript is not available"). If the catalogue
        // holds a sermon newer than anything we have text for, fetch it here
        // rather than depending on the agent to follow the instruction.
        const newestWithContent = [...contentSermonIds]
          .map((id) => catalogueEntries.get(id))
          .filter((d): d is string => Boolean(d))
          .sort()
          .pop();

        const unread = [...catalogueEntries.entries()]
          .filter(([id, date]) => !contentSermonIds.has(id) && (!newestWithContent || date > newestWithContent))
          .sort(([, a], [, b]) => b.localeCompare(a))
          .slice(0, MAX_BACKSTOP_TRANSCRIPTS);

        if (unread.length > 0) {
          sendStatus(`Reading ${unread.length} newer sermon${unread.length > 1 ? "s" : ""} the search missed...`);
          for (const [sermonID] of unread) {
            const fetched = await tools.getSermonTranscript.execute!(
              { sermonID },
              { toolCallId: `backstop-${sermonID}`, messages: [] }
            );
            if (fetched && typeof fetched === "object" && "transcript" in fetched) {
              const v = fetched as { title: string; preacher: string; bibleText?: string; preachDate?: string; transcript: string };
              contextChunks.push(
                `[Source: "${v.title}" by ${v.preacher}${v.bibleText ? ` (${v.bibleText})` : ""}${v.preachDate ? `, ${v.preachDate}` : ""}]\n${v.transcript}`
              );
              console.log(`[ai-search] backstop fetched transcript for ${sermonID} (${v.preachDate})`);
            }
          }
        }

        if (contextChunks.length === 0 && sources.size === 0) {
          controller.enqueue(encoder.encode(`§ERROR:No relevant sermon content found\n`));
          controllerClosed = true;
          controller.close();
          return;
        }

        const formattedContext = contextChunks.join("\n\n---\n\n");

        console.log(
          `[ai-search] context blocks=${contextChunks.length} | chars=${formattedContext.length} | catalogue=${contextChunks.some((c) => c.startsWith("[Sermon catalogue"))}`
        );

        // --- Phase B: Streaming Answer ---
        const result = streamText({
          model: answerModel,
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

        // Send sources and signal end of status updates
        const sourcesArray = Array.from(sources.values());
        sendStatus(`Found ${sourcesArray.length} sermons — generating answer...`);
        if (!controllerClosed) {
          try {
            controller.enqueue(encoder.encode(`§SOURCES:${JSON.stringify(sourcesArray)}\n`));
            controller.enqueue(encoder.encode("§END_STATUS\n"));
          } catch {
            controllerClosed = true;
          }
        }

        // Pipe answer stream
        const reader = result.textStream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done || controllerClosed) break;
            try {
              controller.enqueue(encoder.encode(value));
            } catch {
              controllerClosed = true;
              break;
            }
          }
        } finally {
          reader.releaseLock();
        }

        if (!controllerClosed) {
          controllerClosed = true;
          controller.close();
        }
      } catch (err) {
        if (!controllerClosed) {
          console.error(`[ai-search] error (${provider}):`, err);
          try {
            controller.enqueue(
              encoder.encode(`§ERROR:${err instanceof Error ? err.message : "Unknown error"}\n`)
            );
            controller.close();
          } catch { /* controller already closed */ }
          controllerClosed = true;
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
