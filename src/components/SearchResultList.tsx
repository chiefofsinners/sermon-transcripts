import type { ReactNode } from "react";
import type { SermonMeta, SermonSnippet } from "@/lib/types";
import SearchResultCard from "./SearchResultCard";

export default function SearchResultList({
  sermons,
  totalCount,
  snippets,
  snippetsLoading,
  query,
  sortControl,
  pageSizeControl,
}: {
  sermons: SermonMeta[];
  totalCount: number;
  snippets: Record<string, SermonSnippet[]>;
  snippetsLoading: boolean;
  query: string;
  sortControl?: ReactNode;
  pageSizeControl?: ReactNode;
}) {
  if (totalCount === 0) {
    return (
      <p className="text-center text-gray-500 dark:text-gray-400 py-12">
        No sermons found for &ldquo;{query}&rdquo;
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pt-4 mb-4">
        <div className="flex items-center gap-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {totalCount} result{totalCount !== 1 ? "s" : ""}
          </p>
          {pageSizeControl}
        </div>
        {sortControl}
      </div>
      {sermons.map((sermon) => (
        <SearchResultCard
          key={sermon.id}
          sermon={sermon}
          snippets={snippets[sermon.id]}
          loading={snippetsLoading && !snippets[sermon.id]}
          query={query}
        />
      ))}
    </div>
  );
}
