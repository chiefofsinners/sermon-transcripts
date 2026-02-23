"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import ReadingSettingsProvider, { useReadingSettings } from "./ReadingSettingsProvider";
import ReadingSettingsOverlay from "./ReadingSettingsOverlay";

type AiProvider = "anthropic" | "openai" | "xai";

const AI_PROVIDERS: { value: AiProvider; label: string }[] = [
  { value: "anthropic", label: "Claude" },
  { value: "openai", label: "GPT" },
  { value: "xai", label: "Grok" },
];

interface Source {
  sermonID: string;
  title: string;
  preacher: string;
  preachDate: string;
  bibleText: string;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const AI_CACHE_KEY = "ai-search-cache";

interface AiCacheEntry {
  response: string;
  sources: Source[];
}

interface AiCacheStore {
  // Keyed by "query\0provider"
  entries: Record<string, AiCacheEntry>;
  // Last used provider (for restoring selection on back-nav)
  lastProvider: AiProvider;
}

function cacheKey(query: string, provider: AiProvider): string {
  return `${query}\0${provider}`;
}

function readCacheStore(): AiCacheStore | null {
  try {
    const raw = sessionStorage.getItem(AI_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Ignore old cache format (pre-multi-provider)
    if (!parsed.entries) return null;
    return parsed;
  } catch {}
  return null;
}

function readAiCache(query: string, provider: AiProvider): AiCacheEntry | null {
  const store = readCacheStore();
  if (!store) return null;
  return store.entries[cacheKey(query, provider)] ?? null;
}

function writeAiCache(query: string, response: string, sources: Source[], provider: AiProvider) {
  try {
    const store = readCacheStore() ?? { entries: {}, lastProvider: provider };
    store.entries[cacheKey(query, provider)] = { response, sources };
    store.lastProvider = provider;
    sessionStorage.setItem(AI_CACHE_KEY, JSON.stringify(store));
  } catch {}
}

// In-memory cache for context (persists across provider switches within the same page lifecycle)
interface ContextCache {
  query: string;
  context: string;
  sources: Source[];
  scope: string;
}

export default function AiSearchResult({ query, submitCount }: { query: string; submitCount?: number }) {
  return (
    <ReadingSettingsProvider>
      <AiSearchResultInner query={query} submitCount={submitCount} />
    </ReadingSettingsProvider>
  );
}

function AiSearchResultInner({ query, submitCount }: { query: string; submitCount?: number }) {
  const [showSettings, setShowSettings] = useState(false);
  const initStore = useRef(readCacheStore());
  const initProvider = initStore.current?.lastProvider ?? "anthropic";
  const cached = useRef(readAiCache(query, initProvider));
  const [response, setResponse] = useState(cached.current?.response ?? "");
  const [sources, setSources] = useState<Source[]>(cached.current?.sources ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(!!cached.current);
  const [provider, setProvider] = useState<AiProvider>(initProvider);
  const abortRef = useRef<AbortController | null>(null);
  const providerRef = useRef(provider);
  providerRef.current = provider;

  // In-memory context cache (survives provider switches, not page navigations)
  const contextCacheRef = useRef<ContextCache | null>(null);

  const fetchContext = useCallback(async (q: string, signal: AbortSignal): Promise<ContextCache | null> => {
    // Return cached context if query matches
    if (contextCacheRef.current && contextCacheRef.current.query === q) {
      return contextCacheRef.current;
    }

    const res = await fetch("/api/ai-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }),
      signal,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Context request failed (${res.status})`);
    }

    const data = await res.json();

    if (data.error) {
      // "No relevant sermon content found" case
      throw new Error(data.error);
    }

    const result: ContextCache = {
      query: q,
      context: data.context,
      sources: data.sources,
      scope: data.scope,
    };

    contextCacheRef.current = result;
    return result;
  }, []);

  const streamAnswer = useCallback(async (ctx: ContextCache, q: string, signal: AbortSignal) => {
    setSources(ctx.sources);

    const res = await fetch("/api/ai-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: ctx.context,
        sources: ctx.sources,
        query: q,
        provider: providerRef.current,
      }),
      signal,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Stream request failed (${res.status})`);
    }

    const contentType = res.headers.get("content-type") || "";

    // Handle non-streaming JSON response (error case)
    if (contentType.includes("application/json")) {
      const data = await res.json();
      if (data.error) {
        throw new Error(data.error);
      }
      return;
    }

    // Read sources from response header (authoritative, from ai-stream)
    try {
      const sourcesHeader = res.headers.get("X-Sources");
      if (sourcesHeader) {
        const parsed = JSON.parse(decodeURIComponent(sourcesHeader));
        if (Array.isArray(parsed)) setSources(parsed);
      }
    } catch {}

    // Handle plain text stream from toTextStreamResponse
    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response stream");

    const decoder = new TextDecoder();
    let accumulated = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      accumulated += chunk;
      // Strip any trailing ---SOURCES--- or --- the model might add
      const display = accumulated.replace(/\n*---\s*SOURCES?\s*---[\s\S]*$/, "").replace(/\n*---\s*$/, "");
      setResponse(display);
    }

    // Final cleanup of accumulated text
    const finalResponse = accumulated
      .replace(/\n*---\s*SOURCES?\s*---[\s\S]*$/, "")
      .replace(/\n*---\s*$/, "")
      .trim();
    if (!finalResponse) {
      throw new Error("No response received from the model. The request may have failed silently.");
    }
    setResponse(finalResponse);
    writeAiCache(q, finalResponse, ctx.sources, providerRef.current);
  }, []);

  const handleSubmit = useCallback(async (q: string) => {
    if (!q.trim()) return;

    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();

    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setResponse("");
    setSources([]);
    setSubmitted(true);

    try {
      const ctx = await fetchContext(q.trim(), controller.signal);
      if (!ctx) return;
      await streamAnswer(ctx, q.trim(), controller.signal);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, [fetchContext, streamAnswer]);

  // Submit when query changes (from the search bar), skip if restored from cache.
  // Also re-submit when submitCount bumps (user clicked send for same query).
  const lastQuery = useRef(cached.current ? query : "");
  const lastSubmitCount = useRef(submitCount ?? 0);
  useEffect(() => {
    if (!query.trim()) {
      // Query cleared — abort and reset
      if (abortRef.current) abortRef.current.abort();
      setResponse("");
      setSources([]);
      setLoading(false);
      setError(null);
      setSubmitted(false);
      lastQuery.current = "";
      return;
    }
    const countChanged = (submitCount ?? 0) !== lastSubmitCount.current;
    if (query !== lastQuery.current || countChanged) {
      lastQuery.current = query;
      lastSubmitCount.current = submitCount ?? 0;
      handleSubmit(query);
    }
  }, [query, submitCount, handleSubmit]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const handleProviderChange = useCallback(async (p: AiProvider) => {
    setProvider(p);
    providerRef.current = p;
    // Only re-submit if we've already shown a response for this query
    if (!query.trim() || !submitted) return;

    // Check session cache before re-fetching
    const hit = readAiCache(query, p);
    if (hit) {
      setResponse(hit.response);
      setSources(hit.sources);
      setError(null);
      // Update lastProvider in the store
      writeAiCache(query, hit.response, hit.sources, p);
      return;
    }

    // If we have cached context for this query, skip the context fetch
    if (contextCacheRef.current && contextCacheRef.current.query === query.trim()) {
      // Cancel any in-flight request
      if (abortRef.current) abortRef.current.abort();

      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      setResponse("");

      try {
        await streamAnswer(contextCacheRef.current, query.trim(), controller.signal);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        if (abortRef.current === controller) {
          setLoading(false);
        }
      }
      return;
    }

    // No cached context — full submit
    handleSubmit(query);
  }, [query, submitted, handleSubmit, streamAnswer]);

  const providerPills = (
    <div className="flex gap-1 items-center font-sans" style={{ fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif" }}>
      <span className="text-xs text-gray-400 dark:text-gray-500 mr-1">Model:</span>
      {AI_PROVIDERS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => handleProviderChange(p.value)}
          className={`px-2.5 py-1 text-xs rounded-full cursor-pointer transition-colors ${
            provider === p.value
              ? "bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
              : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          }`}
        >
          {p.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setShowSettings(true)}
        aria-label="Reading settings"
        className="ml-2 p-1.5 rounded-full text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors cursor-pointer"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  );

  if (!submitted && !query.trim()) {
    return (
      <div>
        <div className="flex justify-end mb-4">{providerPills}</div>
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <p className="text-lg mb-2">Ask a question about the sermons</p>
          <p className="text-sm">
            e.g. &ldquo;What does the Bible say about prayer?&rdquo; or &ldquo;What has been preached about justification by faith?&rdquo;
          </p>
        </div>
        {showSettings && <ReadingSettingsOverlay onClose={() => setShowSettings(false)} />}
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex justify-end mb-4">{providerPills}</div>
      {/* Loading indicator */}
      {loading && (
        <div className="flex items-center gap-2 mb-4 text-gray-500 dark:text-gray-400">
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="text-sm">Searching sermons and generating answer...</span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 mb-4">
          <p className="text-red-700 dark:text-red-400 text-sm">{error}</p>
          <button
            onClick={() => handleSubmit(query)}
            className="mt-2 text-sm text-red-600 dark:text-red-400 underline hover:no-underline cursor-pointer"
          >
            Try again
          </button>
        </div>
      )}

      {/* AI Response */}
      {response && (
        <div className="prose prose-sm dark:prose-invert max-w-none mb-6 text-justify">
          <ResponseMarkdown text={response} sources={sources} />
        </div>
      )}

      {/* Sources list */}
      {sources.length > 0 && !loading && (
        <div className="border-t border-gray-200 dark:border-gray-800 pt-4 mt-6 font-sans" style={{ fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif" }}>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Sources ({sources.length} sermons)
          </h3>
          <ul className="space-y-2">
            {sources.map((s) => (
              <li key={s.sermonID}>
                <Link
                  href={`/sermon/${s.sermonID}`}
                  className="block rounded-lg border border-gray-200 dark:border-gray-800 p-3 hover:bg-gray-100 dark:hover:bg-gray-800/50 transition-colors"
                >
                  <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">
                    {s.title}
                  </span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {s.preacher}
                    {s.bibleText && ` · ${s.bibleText}`}
                    {s.preachDate && ` · ${formatDate(s.preachDate)}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showSettings && <ReadingSettingsOverlay onClose={() => setShowSettings(false)} />}
    </div>
  );
}

/**
 * Simple markdown-ish renderer that handles paragraphs, bold, and
 * converts [Sermon Title, Preacher] citations into links when a matching source exists.
 */
function ResponseMarkdown({ text, sources }: { text: string; sources: Source[] }) {
  // Build lookups by title for citation linking
  const sourceByTitle = new Map<string, Source>();
  const sourceByNormalized = new Map<string, Source>();
  for (const s of sources) {
    sourceByTitle.set(s.title.toLowerCase(), s);
    sourceByNormalized.set(normalizeTitle(s.title), s);
  }

  const paragraphs = text.split(/\n\n+/);

  return (
    <>
      {paragraphs.map((para, i) => {
        const trimmed = para.trim();
        if (!trimmed) return null;

        // Horizontal rule
        if (/^---+$/.test(trimmed)) {
          return <hr key={i} className="border-gray-200 dark:border-gray-800 my-4" />;
        }

        // Heading (strip leading #s)
        const headingMatch = trimmed.match(/^(#{1,4})\s+(.+?)$/m);
        if (headingMatch && trimmed.startsWith("#")) {
          return (
            <p key={i} className="font-semibold text-gray-900 dark:text-gray-100 mt-4 mb-1">
              {processInline(headingMatch[2], sourceByTitle, sourceByNormalized)}
            </p>
          );
        }

        // Bullet list
        if (trimmed.match(/^[-*] /m)) {
          const items = trimmed.split(/\n/).filter((l) => l.match(/^[-*] /));
          return (
            <ul key={i}>
              {items.map((item, j) => (
                <li key={j}>{processInline(item.replace(/^[-*] /, ""), sourceByTitle, sourceByNormalized)}</li>
              ))}
            </ul>
          );
        }

        return <p key={i}>{processInline(trimmed.replace(/\n/g, " "), sourceByTitle, sourceByNormalized)}</p>;
      })}
    </>
  );
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function findSource(title: string, sourceByTitle: Map<string, Source>, sourceByNormalized: Map<string, Source>): Source | undefined {
  // 1. Exact case-insensitive match
  const exact = sourceByTitle.get(title.toLowerCase());
  if (exact) return exact;

  // 2. Normalized match (strip punctuation)
  const normalized = normalizeTitle(title);
  const norm = sourceByNormalized.get(normalized);
  if (norm) return norm;

  // 3. Substring match — citation title contains or is contained by a source title
  for (const [key, source] of sourceByNormalized) {
    if (key.includes(normalized) || normalized.includes(key)) return source;
  }

  return undefined;
}

function processInline(
  text: string,
  sourceByTitle: Map<string, Source>,
  sourceByNormalized: Map<string, Source>
): React.ReactNode {
  // Match [Sermon Title, Preacher] citation patterns, **bold**, and *italic*
  const parts: React.ReactNode[] = [];
  // Combined regex: citations [Title, Author], bold **text**, or italic *text*
  const pattern = /\[([^\]]+?),\s*([^\]]+?)\]|\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }

    if (match[3] !== undefined) {
      // Bold — recurse so citations inside bold are still linked
      parts.push(<strong key={key++}>{processInline(match[3], sourceByTitle, sourceByNormalized)}</strong>);
    } else if (match[4] !== undefined) {
      // Italic — recurse so citations inside italic are still linked
      parts.push(<em key={key++}>{processInline(match[4], sourceByTitle, sourceByNormalized)}</em>);
    } else {
      // Citation — may contain multiple semicolon-separated citations
      const fullText = match[1] + ", " + match[2];
      const citations = fullText.split(/;\s*/);
      citations.forEach((cite, ci) => {
        if (ci > 0) parts.push("; ");
        const commaIdx = cite.lastIndexOf(",");
        if (commaIdx === -1) {
          parts.push(cite.trim());
          return;
        }
        const title = cite.slice(0, commaIdx).trim();
        const preacher = cite.slice(commaIdx + 1).trim();
        const source = findSource(title, sourceByTitle, sourceByNormalized);
        if (source) {
          parts.push(
            <Link
              key={key++}
              href={`/sermon/${source.sermonID}`}
              className="text-gray-700 dark:text-gray-300 underline decoration-gray-400 dark:decoration-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
            >
              {title}, {preacher}
            </Link>
          );
        } else {
          parts.push(
            <span key={key++} className="text-gray-700 dark:text-gray-300 underline decoration-gray-400 dark:decoration-gray-500">
              [{title}, {preacher}]
            </span>
          );
        }
      });
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  return parts.length > 0 ? <>{parts}</> : text;
}
