"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";

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

export default function AiSearchResult({ query }: { query: string }) {
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
      const res = await fetch("/api/ai-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q.trim(), provider: providerRef.current }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      const contentType = res.headers.get("content-type") || "";

      // Handle non-streaming JSON response (e.g. "no results" case)
      if (contentType.includes("application/json")) {
        const data = await res.json();
        if (data.error) {
          setResponse(data.error);
        }
        setLoading(false);
        return;
      }

      // Handle Vercel AI SDK data stream
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        // Vercel AI SDK data stream format: lines like `0:"text"\n`
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (line.startsWith("0:")) {
            try {
              const text = JSON.parse(line.slice(2));
              accumulated += text;
              setResponse(accumulated);
            } catch {
              // Skip malformed lines
            }
          }
        }
      }

      // Extract sources from the response (flexible match for model variations)
      const markerMatch = accumulated.match(/---\s*SOURCES\s*---/);
      let finalResponse = accumulated;
      let finalSources: Source[] = [];
      if (markerMatch && markerMatch.index !== undefined) {
        finalResponse = accumulated.slice(0, markerMatch.index).trim();
        const sourceJson = accumulated.slice(markerMatch.index + markerMatch[0].length).trim();
        try {
          const parsed = JSON.parse(sourceJson);
          if (Array.isArray(parsed)) finalSources = parsed;
        } catch {
          // Sources may not parse — that's ok
        }
      }
      setResponse(finalResponse);
      setSources(finalSources);
      writeAiCache(q.trim(), finalResponse, finalSources, providerRef.current);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, []);

  // Submit when query changes (from the search bar), skip if restored from cache
  const lastQuery = useRef(cached.current ? query : "");
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
    if (query !== lastQuery.current) {
      lastQuery.current = query;
      handleSubmit(query);
    }
  }, [query, handleSubmit]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const handleProviderChange = useCallback((p: AiProvider) => {
    setProvider(p);
    providerRef.current = p;
    // Only re-submit if we've already shown a response for this query
    if (!query.trim() || !submitted) return;

    // Check cache before re-submitting
    const hit = readAiCache(query, p);
    if (hit) {
      setResponse(hit.response);
      setSources(hit.sources);
      setError(null);
      // Update lastProvider in the store
      writeAiCache(query, hit.response, hit.sources, p);
      return;
    }

    handleSubmit(query);
  }, [query, submitted, handleSubmit]);

  const providerPills = (
    <div className="flex gap-1 items-center">
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
        <div className="prose prose-sm dark:prose-invert max-w-none mb-6">
          <ResponseMarkdown text={response} sources={sources} />
        </div>
      )}

      {/* Sources list */}
      {sources.length > 0 && !loading && (
        <div className="border-t border-gray-200 dark:border-gray-800 pt-4 mt-6">
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
    </div>
  );
}

/**
 * Simple markdown-ish renderer that handles paragraphs, bold, and
 * converts [Sermon Title, Preacher] citations into links when a matching source exists.
 */
function ResponseMarkdown({ text, sources }: { text: string; sources: Source[] }) {
  // Build a lookup by title for citation linking
  const sourceByTitle = new Map<string, Source>();
  for (const s of sources) {
    sourceByTitle.set(s.title.toLowerCase(), s);
  }

  const paragraphs = text.split(/\n\n+/);

  return (
    <>
      {paragraphs.map((para, i) => {
        const trimmed = para.trim();
        if (!trimmed) return null;

        // Heading (strip leading #s)
        const headingMatch = trimmed.match(/^(#{1,4})\s+(.+?)$/m);
        if (headingMatch && trimmed.startsWith("#")) {
          return <h3 key={i}>{processInline(headingMatch[2], sourceByTitle)}</h3>;
        }

        // Bullet list
        if (trimmed.match(/^[-*] /m)) {
          const items = trimmed.split(/\n/).filter((l) => l.match(/^[-*] /));
          return (
            <ul key={i}>
              {items.map((item, j) => (
                <li key={j}>{processInline(item.replace(/^[-*] /, ""), sourceByTitle)}</li>
              ))}
            </ul>
          );
        }

        return <p key={i}>{processInline(trimmed.replace(/\n/g, " "), sourceByTitle)}</p>;
      })}
    </>
  );
}

function processInline(
  text: string,
  sourceByTitle: Map<string, Source>
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
      // Bold
      parts.push(<strong key={key++}>{match[3]}</strong>);
    } else if (match[4] !== undefined) {
      // Italic
      parts.push(<em key={key++}>{match[4]}</em>);
    } else {
      // Citation
      const title = match[1].trim();
      const source = sourceByTitle.get(title.toLowerCase());
      if (source) {
        parts.push(
          <Link
            key={key++}
            href={`/sermon/${source.sermonID}`}
            className="text-gray-700 dark:text-gray-300 underline decoration-gray-400 dark:decoration-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
          >
            {title}, {match[2].trim()}
          </Link>
        );
      } else {
        parts.push(
          <span key={key++} className="text-gray-700 dark:text-gray-300 underline decoration-gray-400 dark:decoration-gray-500">
            [{title}, {match[2].trim()}]
          </span>
        );
      }
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  return parts.length > 0 ? <>{parts}</> : text;
}
