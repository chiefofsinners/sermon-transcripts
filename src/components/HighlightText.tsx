"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { parseQuery, stripQuotes } from "@/lib/parseQuery";
import type { SearchMode } from "@/lib/types";

/**
 * Highlights search terms and phrases within a string of text.
 * Reads the `q` query parameter from the URL client-side so the
 * parent page can remain fully static.
 */
export default function HighlightText({ text }: { text: string }) {
  return (
    <Suspense fallback={<>{text}</>}>
      <HighlightTextInner text={text} />
    </Suspense>
  );
}

function HighlightTextInner({ text }: { text: string }) {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const mode = (searchParams.get("mode") as SearchMode) || "all";

  if (!query.trim()) return <>{text}</>;

  const { phrases, terms } = mode === "exact"
    ? { phrases: [stripQuotes(query.trim()).toLowerCase()], terms: [] as string[] }
    : parseQuery(query);

  const parts: string[] = [];
  for (const phrase of phrases) {
    parts.push(escapeRegex(phrase));
  }
  for (const term of terms) {
    parts.push(`\\b${escapeRegex(term)}\\b`);
  }
  if (parts.length === 0) return <>{text}</>;

  const regex = new RegExp(`(${parts.join("|")})`, "gi");
  const segments = text.split(regex);

  return (
    <>
      {segments.map((segment, i) =>
        regex.test(segment) ? (
          <mark
            key={i}
            className="bg-yellow-200 dark:bg-yellow-700/50 text-inherit rounded-sm px-0.5"
          >
            {segment}
          </mark>
        ) : (
          <span key={i}>{segment}</span>
        )
      )}
    </>
  );
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
