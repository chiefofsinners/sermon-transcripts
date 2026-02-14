import Link from "next/link";
import { useMemo } from "react";
import type { SermonMeta, SermonSnippet, SearchMode } from "@/lib/types";
import { parseQuery, stripQuotes } from "@/lib/parseQuery";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const MARK_CLASS =
  "bg-yellow-200 dark:bg-yellow-700/50 text-gray-900 dark:text-yellow-100 rounded-sm px-0.5";

/** Highlight all occurrences of phrases/terms in a plain string. */
function highlightText(
  text: string,
  phrases: string[],
  terms: string[]
): React.ReactNode {
  if (phrases.length === 0 && terms.length === 0) return text;

  // Build a single regex matching all phrases and terms (longest first to prefer phrase matches)
  const patterns = [...phrases, ...terms]
    .sort((a, b) => b.length - a.length)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${patterns.join("|")})`, "gi");

  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    parts.push(
      <mark key={i++} className={MARK_CLASS}>
        {match[0]}
      </mark>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length > 0 ? <>{parts}</> : text;
}

function HighlightedSnippet({ snippet }: { snippet: SermonSnippet }) {
  const { text, matches } = snippet;
  if (matches.length === 0) return <span>{text}</span>;

  const sorted = [...matches].sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (let i = 0; i < sorted.length; i++) {
    const { start, end } = sorted[i];
    if (start > cursor) {
      parts.push(<span key={`t-${i}`}>{text.slice(cursor, start)}</span>);
    }
    parts.push(
      <mark key={`m-${i}`} className={MARK_CLASS}>
        {text.slice(start, end)}
      </mark>
    );
    cursor = end;
  }
  if (cursor < text.length) {
    parts.push(<span key="tail">{text.slice(cursor)}</span>);
  }
  return <>{parts}</>;
}

export default function SearchResultCard({
  sermon,
  snippets,
  loading,
  query,
  searchMode = "all",
}: {
  sermon: SermonMeta;
  snippets?: SermonSnippet[];
  loading?: boolean;
  query?: string;
  searchMode?: SearchMode;
}) {
  const { phrases, terms } = useMemo(() => {
    if (!query) return { phrases: [] as string[], terms: [] as string[] };
    if (searchMode === "exact") {
      return { phrases: [stripQuotes(query.trim()).toLowerCase()], terms: [] };
    }
    return parseQuery(query);
  }, [query, searchMode]);

  const modeParam = searchMode !== "all" ? `&mode=${searchMode}` : "";
  const href = query
    ? `/sermon/${sermon.id}?q=${encodeURIComponent(query)}${modeParam}`
    : `/sermon/${sermon.id}`;

  const hl = (text: string) => highlightText(text, phrases, terms);

  return (
    <Link
      href={href}
      className="block p-5 border border-gray-300 dark:border-gray-700 rounded-lg hover:border-gray-400 dark:hover:border-gray-500 hover:shadow-sm transition-all bg-gray-200 dark:bg-gray-900"
    >
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 leading-snug">
        {hl(sermon.title || sermon.displayTitle)}
      </h3>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-base sm:text-sm text-gray-500 dark:text-gray-400">
        <span>{hl(sermon.preacher)}</span>
        {sermon.preachDate && (
          <span>
            {formatDate(sermon.preachDate)}
            {sermon.eventType === "Sunday - AM" && " (AM)"}
            {sermon.eventType === "Sunday - PM" && " (PM)"}
            {sermon.eventType === "Other" && " (Other)"}
          </span>
        )}
        {sermon.bibleText && (
          <span className="text-gray-700 dark:text-gray-300 font-medium">{hl(sermon.bibleText)}</span>
        )}
      </div>
      {sermon.series && (
        <div className="mt-1.5 text-sm sm:text-xs text-gray-500">
          Series: {hl(sermon.series)}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {loading ? (
          <div className="space-y-1.5">
            <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded animate-pulse w-full" />
            <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded animate-pulse w-4/5" />
          </div>
        ) : snippets && snippets.length > 0 ? (
          snippets.map((snippet, i) => (
            <p key={i} className="text-base sm:text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
              <span className="text-gray-500">&hellip; </span>
              <HighlightedSnippet snippet={snippet} />
              <span className="text-gray-500"> &hellip;</span>
            </p>
          ))
        ) : null}
      </div>
    </Link>
  );
}
