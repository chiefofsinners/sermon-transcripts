"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import ReadingSettingsProvider, { useReadingSettings } from "./ReadingSettingsProvider";
import ReadingSettingsOverlay from "./ReadingSettingsOverlay";

type AiProvider = "anthropic" | "deepseek" | "openai" | "xai";

const AI_PROVIDERS: { value: AiProvider; label: string }[] = [
  { value: "anthropic", label: "Claude" },
  { value: "deepseek", label: "DeepSeek" },
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

// ──────────────────────────────────────────────────────────────
// Module-level live stream — survives component unmount/remount
// ──────────────────────────────────────────────────────────────

type StreamListener = () => void;

interface LiveStream {
  query: string;
  provider: AiProvider;
  response: string;
  sources: Source[];
  statusMessage: string;
  loading: boolean;
  error: string | null;
  listeners: Set<StreamListener>;
}

let liveStream: LiveStream | null = null;

function notifyListeners() {
  if (liveStream) {
    for (const fn of liveStream.listeners) fn();
  }
}

/** Start a new background stream. Writes to liveStream and notifies listeners. */
function startLiveStream(query: string, provider: AiProvider) {
  // Abort any existing stream by marking it done (the old fetch will just write
  // to a stale reference that nothing listens to)
  const stream: LiveStream = {
    query,
    provider,
    response: "",
    sources: [],
    statusMessage: "Searching sermons...",
    loading: true,
    error: null,
    listeners: liveStream?.listeners ?? new Set(),
  };
  liveStream = stream;
  notifyListeners();

  // Fire-and-forget — runs even after unmount
  (async () => {
    try {
      const res = await fetch("/api/ai-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, provider }),
      });

      // If a newer stream started while we were fetching, bail out
      if (liveStream !== stream) return;

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Search request failed (${res.status})`);
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      let inAnswer = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (liveStream !== stream) { reader.cancel(); return; }

        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const nlIndex = buffer.indexOf("\n");
          if (nlIndex === -1) break;
          const line = buffer.slice(0, nlIndex);
          buffer = buffer.slice(nlIndex + 1);

          if (!inAnswer) {
            if (line === "§END_STATUS") {
              inAnswer = true;
            } else if (line.startsWith("§SOURCES:")) {
              try {
                const parsed = JSON.parse(line.slice(9));
                if (Array.isArray(parsed)) {
                  stream.sources = parsed;
                  notifyListeners();
                }
              } catch {}
            } else if (line.startsWith("§STATUS:")) {
              stream.statusMessage = line.slice(8);
              notifyListeners();
            } else if (line.startsWith("§ERROR:")) {
              throw new Error(line.slice(7));
            }
          } else {
            accumulated += (accumulated ? "\n" : "") + line;
            stream.response = accumulated
              .replace(/\n*---\s*SOURCES?\s*---[\s\S]*$/, "")
              .replace(/\n*---\s*$/, "");
            notifyListeners();
          }
        }

        if (inAnswer && buffer) {
          stream.response = (accumulated + (accumulated ? "\n" : "") + buffer)
            .replace(/\n*---\s*SOURCES?\s*---[\s\S]*$/, "")
            .replace(/\n*---\s*$/, "");
          notifyListeners();
        }
      }

      // Flush remaining buffer
      if (buffer) {
        accumulated += (accumulated ? "\n" : "") + buffer;
      }

      if (liveStream !== stream) return;

      const finalResponse = accumulated
        .replace(/\n*---\s*SOURCES?\s*---[\s\S]*$/, "")
        .replace(/\n*---\s*$/, "")
        .trim();

      if (!finalResponse) {
        const providerName = { anthropic: "Claude", deepseek: "DeepSeek", openai: "GPT", xai: "Grok" }[provider] || "The model";
        throw new Error(`${providerName} is currently unavailable. Try again or switch to a different model.`);
      }

      stream.response = finalResponse;
      stream.loading = false;
      notifyListeners();
      writeAiCache(query, finalResponse, stream.sources, provider);
    } catch (err) {
      if (liveStream !== stream) return;
      stream.error = err instanceof Error ? err.message : "Something went wrong";
      stream.loading = false;
      notifyListeners();
    }
  })();
}

/** Subscribe to live stream updates. Returns unsubscribe function. */
function subscribeLiveStream(listener: StreamListener): () => void {
  if (liveStream) {
    liveStream.listeners.add(listener);
  }
  return () => {
    if (liveStream) liveStream.listeners.delete(listener);
  };
}


export default function AiSearchResult({ query, submitCount }: { query: string; submitCount?: number }) {
  return (
    <ReadingSettingsProvider>
      <AiSearchResultInner query={query} submitCount={submitCount} />
    </ReadingSettingsProvider>
  );
}

const fontSizeMap = { small: "0.9rem", medium: "1.15rem", large: "1.45rem", xlarge: "1.8rem" } as const;
const fontFamilyMap = {
  sans: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
} as const;

function AiSearchResultInner({ query, submitCount }: { query: string; submitCount?: number }) {
  const { fontSize, fontFamily } = useReadingSettings();
  const [showSettings, setShowSettings] = useState(false);
  const initStore = useRef(readCacheStore());
  const initProvider = initStore.current?.lastProvider ?? "anthropic";
  const cached = useRef(readAiCache(query, initProvider));
  const [, forceUpdate] = useState(0);
  const [copied, setCopied] = useState(false);
  const [submitted, setSubmitted] = useState(!!cached.current);
  const [provider, setProvider] = useState<AiProvider>(initProvider);

  // Sync React state from live stream or cache on mount/update
  const syncFromLiveStream = useCallback(() => forceUpdate((n) => n + 1), []);

  // Determine current display state: live stream > cache > empty
  const isLiveForQuery =
    liveStream && liveStream.query === query && liveStream.provider === provider;
  const response = isLiveForQuery
    ? liveStream!.response
    : cached.current?.response ?? "";
  const sources = isLiveForQuery
    ? liveStream!.sources
    : cached.current?.sources ?? [];
  const loading = isLiveForQuery ? liveStream!.loading : false;
  const statusMessage = isLiveForQuery
    ? liveStream!.statusMessage
    : "Searching sermons...";
  const error = isLiveForQuery ? liveStream!.error : null;

  // Subscribe to live stream updates
  useEffect(() => {
    return subscribeLiveStream(syncFromLiveStream);
  }, [syncFromLiveStream]);

  const handleSubmit = useCallback((q: string) => {
    if (!q.trim()) return;
    setSubmitted(true);
    startLiveStream(q.trim(), provider);
  }, [provider]);

  // Submit when query changes (from the search bar), skip if restored from cache.
  // Also re-submit when submitCount bumps (user clicked send for same query).
  // Only skip the initial submit if we actually have a cached response to display.
  const hasRestoredResponse = !!(cached.current?.response);
  const lastQuery = useRef(hasRestoredResponse ? query : "");
  const lastSubmitCount = useRef(hasRestoredResponse ? (submitCount ?? 0) : 0);
  useEffect(() => {
    if (!query.trim()) {
      // Query cleared — reset
      setSubmitted(false);
      lastQuery.current = "";
      return;
    }

    // If there's already a live stream for this exact query+provider, just subscribe
    if (
      liveStream &&
      liveStream.query === query.trim() &&
      liveStream.provider === provider &&
      (liveStream.loading || liveStream.response)
    ) {
      setSubmitted(true);
      lastQuery.current = query;
      lastSubmitCount.current = submitCount ?? 0;
      return;
    }

    const countChanged = (submitCount ?? 0) !== lastSubmitCount.current;
    if (query !== lastQuery.current || countChanged) {
      lastQuery.current = query;
      lastSubmitCount.current = submitCount ?? 0;
      handleSubmit(query);
    }
  }, [query, submitCount, handleSubmit, provider]);

  const handleProviderChange = useCallback((p: AiProvider) => {
    setProvider(p);
    // Only re-submit if we've already shown a response for this query
    if (!query.trim() || !submitted) return;

    // Check session cache before re-fetching
    const hit = readAiCache(query, p);
    if (hit) {
      // Clear live stream so we show the cached version
      liveStream = null;
      cached.current = hit;
      forceUpdate((n) => n + 1);
      // Update lastProvider in the store
      writeAiCache(query, hit.response, hit.sources, p);
      return;
    }

    // Full re-query for new provider
    setSubmitted(true);
    startLiveStream(query.trim(), p);
  }, [query, submitted]);

  const handleCopy = useCallback(() => {
    if (!response) return;
    navigator.clipboard.writeText(response).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [response]);

  const providerPills = (
    <div className="flex items-start justify-between font-sans" style={{ fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif" }}>
      <div className="flex flex-wrap gap-1 items-center min-w-0">
        <span className="text-xs text-gray-400 dark:text-gray-500 mr-1 shrink-0">Model:</span>
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
      <div className="flex items-center gap-1 shrink-0">
        {response && (
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy response"
            className="p-1.5 rounded-full text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors cursor-pointer"
          >
            {copied ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowSettings(true)}
          aria-label="Reading settings"
          className="p-1.5 rounded-full text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors cursor-pointer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </div>
    </div>
  );

  if (!submitted && !query.trim()) {
    return (
      <div>
        <div className="mb-4">{providerPills}</div>
        <div className="text-center pt-10 pb-10 lg:pt-24 lg:pb-24 text-gray-500 dark:text-gray-400">
          <p style={{ fontSize: fontSizeMap[fontSize], fontFamily: fontFamilyMap[fontFamily], lineHeight: 1.6 }}>
            AI will attempt to provide an answer or summary here when you submit a query.
          </p>
        </div>
        {showSettings && <ReadingSettingsOverlay onClose={() => setShowSettings(false)} />}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">{providerPills}</div>
      {/* Loading indicator */}
      {loading && (
        <div className="flex items-center gap-2 mb-4 text-gray-500 dark:text-gray-400" style={{ fontSize: fontSizeMap[fontSize], fontFamily: fontFamilyMap[fontFamily] }}>
          <svg
            className="animate-spin shrink-0"
            width="1em"
            height="1em"
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
          <span>{statusMessage}</span>
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
        <div className="@container border-t border-gray-200 dark:border-gray-800 pt-4 mt-6 font-sans text-base" style={{ fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif" }}>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            References ({sources.length} sermons)
          </h3>
          <ul className="grid grid-cols-1 @md:grid-cols-2 @3xl:grid-cols-3 gap-3 items-start list-none p-0 m-0">
            {sources.map((s, idx) => (
              <li key={s.sermonID} className="p-0">
                <Link
                  href={`/sermon/${s.sermonID}`}
                  className="block rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 pt-3 pb-4 leading-tight hover:bg-gray-200 dark:hover:bg-gray-700/50 hover:border-gray-400 dark:hover:border-gray-500 transition-colors no-underline"
                >
                  <span className="font-medium text-gray-900 dark:text-gray-100 text-sm/tight">
                    <span className="text-gray-400 dark:text-gray-500 mr-1">[{idx + 1}]</span>
                    {s.title}
                  </span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1.5 pl-5">
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
  const sourceIndex = new Map<string, number>();
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    sourceByTitle.set(s.title.toLowerCase(), s);
    sourceByNormalized.set(normalizeTitle(s.title), s);
    sourceIndex.set(s.sermonID, i + 1);
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

        // Heading (strip leading #s) — may have body text after the heading line
        const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/m);
        if (headingMatch && trimmed.startsWith("#")) {
          const headingText = headingMatch[2];
          const rest = trimmed.slice(trimmed.indexOf("\n") + 1).trim();
          return (
            <React.Fragment key={i}>
              <p className="font-semibold text-gray-900 dark:text-gray-100 mt-4 mb-1">
                {processInline(headingText, sourceByTitle, sourceByNormalized, sourceIndex)}
              </p>
              {rest && trimmed.includes("\n") && (
                <p>{processInline(rest.replace(/\n/g, " "), sourceByTitle, sourceByNormalized, sourceIndex)}</p>
              )}
            </React.Fragment>
          );
        }

        // Bullet list
        if (trimmed.match(/^[-*] /m)) {
          const items = trimmed.split(/\n/).filter((l) => l.match(/^[-*] /));
          return (
            <ul key={i}>
              {items.map((item, j) => (
                <li key={j}>{processInline(item.replace(/^[-*] /, ""), sourceByTitle, sourceByNormalized, sourceIndex)}</li>
              ))}
            </ul>
          );
        }

        return <p key={i}>{processInline(trimmed.replace(/\n/g, " "), sourceByTitle, sourceByNormalized, sourceIndex)}</p>;
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
  sourceByNormalized: Map<string, Source>,
  sourceIndex: Map<string, number>
): React.ReactNode {
  // Match [Sermon Title, Preacher] citation patterns, [Title] without preacher, **bold**, and *italic*
  const parts: React.ReactNode[] = [];
  // Combined regex: citations [Title, Author], title-only citations [Title] (3+ chars, no comma, not followed by parens), bold **text**, or italic *text*
  const pattern = /\[([^\]]+?),\s*([^\]]+?)\](?!\()|\[([^\],]{3,}?)\](?!\()|\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }

    if (match[4] !== undefined) {
      // Bold — recurse so citations inside bold are still linked
      parts.push(<strong key={key++}>{processInline(match[4], sourceByTitle, sourceByNormalized, sourceIndex)}</strong>);
    } else if (match[5] !== undefined) {
      // Italic — recurse so citations inside italic are still linked
      parts.push(<em key={key++}>{processInline(match[5], sourceByTitle, sourceByNormalized, sourceIndex)}</em>);
    } else if (match[3] !== undefined) {
      // Title-only citation [Title] — no preacher name provided
      const title = match[3].trim();
      const source = findSource(title, sourceByTitle, sourceByNormalized);
      if (source) {
        const num = sourceIndex.get(source.sermonID) ?? "?";
        parts.push(
          <Link
            key={key++}
            href={`/sermon/${source.sermonID}`}
            className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors no-underline"
            title={`${source.title} — ${source.preacher}`}
          >
            <span className="italic">{source.title}</span>
            <span
              className="inline-flex items-center justify-center text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-700 rounded px-1 py-0.5 min-w-5 align-super"
              style={{ fontSize: "0.7em", lineHeight: 1, verticalAlign: "super" }}
            >
              [{num}]
            </span>
          </Link>
        );
      } else {
        parts.push(
          <span key={key++} className="italic text-gray-400 dark:text-gray-500">
            {title}
            <span style={{ fontSize: "0.7em", verticalAlign: "super" }}> [?]</span>
          </span>
        );
      }
    } else {
      // Citation with preacher — may contain multiple semicolon-separated citations
      const fullText = match[1] + ", " + match[2];
      const citations = fullText.split(/;\s*/);
      citations.forEach((cite, ci) => {
        if (ci > 0) parts.push(" ");
        const commaIdx = cite.lastIndexOf(",");
        if (commaIdx === -1) {
          parts.push(cite.trim());
          return;
        }
        const title = cite.slice(0, commaIdx).trim();
        const preacher = cite.slice(commaIdx + 1).trim();
        const source = findSource(title, sourceByTitle, sourceByNormalized);
        if (source) {
          const num = sourceIndex.get(source.sermonID) ?? "?";
          parts.push(
            <Link
              key={key++}
              href={`/sermon/${source.sermonID}`}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors no-underline"
              title={`${source.title} — ${source.preacher}`}
            >
              <span className="italic">{source.title}, {preacher}</span>
              <span
                className="inline-flex items-center justify-center text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-700 rounded px-1 py-0.5 min-w-5 align-super"
                style={{ fontSize: "0.7em", lineHeight: 1, verticalAlign: "super" }}
              >
                [{num}]
              </span>
            </Link>
          );
        } else {
          parts.push(
            <span key={key++} className="italic text-gray-400 dark:text-gray-500">
              {title}, {preacher}
              <span style={{ fontSize: "0.7em", verticalAlign: "super" }}> [?]</span>
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
