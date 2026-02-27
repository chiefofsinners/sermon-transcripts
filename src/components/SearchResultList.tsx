import type { ReactNode } from "react";
import type { SermonMeta, SermonSnippet, SearchMode } from "@/lib/types";
import SearchResultCard from "./SearchResultCard";

export default function SearchResultList({
  sermons,
  totalCount,
  snippets,
  snippetsLoading,
  query,
  searchMode,
  sortControl,
  pageSizeControl,
  twoColumn,
}: {
  sermons: SermonMeta[];
  totalCount: number;
  snippets: Record<string, SermonSnippet[]>;
  snippetsLoading: boolean;
  query: string;
  searchMode?: SearchMode;
  sortControl?: ReactNode;
  pageSizeControl?: ReactNode;
  twoColumn?: boolean;
}) {
  if (totalCount === 0) {
    if (snippetsLoading) {
      // Phrase-filtering in progress — show skeleton instead of "no results"
      return (
        <div className="space-y-3 pt-8">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-5 border border-gray-300 dark:border-gray-700 rounded-lg bg-gray-200 dark:bg-gray-900 animate-pulse">
              <div className="h-5 bg-gray-300 dark:bg-gray-800 rounded w-3/4 mb-3" />
              <div className="h-3 bg-gray-300 dark:bg-gray-800 rounded w-1/2 mb-4" />
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-full mb-1.5" />
              <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-4/5" />
            </div>
          ))}
        </div>
      );
    }
    return (
      <p className="text-center text-gray-500 dark:text-gray-400 py-12">
        No sermons found for &ldquo;{query}&rdquo;
      </p>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between pt-4 mb-4">
        <div className="flex items-center gap-4">
          <p className="text-base sm:text-sm text-gray-500 dark:text-gray-400">
            {totalCount} result{totalCount !== 1 ? "s" : ""}
          </p>
          {pageSizeControl}
        </div>
        {sortControl}
      </div>
      <div className={twoColumn ? "grid grid-cols-1 lg:grid-cols-2 gap-3" : "space-y-3"}>
        {sermons.map((sermon) => (
          <SearchResultCard
            key={sermon.id}
            sermon={sermon}
            snippets={snippets[sermon.id]}
            loading={snippetsLoading && !snippets[sermon.id]}
            query={query}
            searchMode={searchMode}
          />
        ))}
      </div>
    </div>
  );
}
