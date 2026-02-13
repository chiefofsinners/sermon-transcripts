import type { ReactNode } from "react";
import type { SermonMeta } from "@/lib/types";
import SermonCard from "./SermonCard";

export default function SermonList({
  sermons,
  totalCount,
  sortControl,
  pageSizeControl,
}: {
  sermons: SermonMeta[];
  totalCount: number;
  sortControl?: ReactNode;
  pageSizeControl?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pt-4 mb-4">
        <div className="flex items-center gap-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {totalCount.toLocaleString()} sermon{totalCount !== 1 ? "s" : ""}
          </p>
          {pageSizeControl}
        </div>
        {sortControl}
      </div>
      {sermons.map((sermon) => (
        <SermonCard key={sermon.id} sermon={sermon} />
      ))}
    </div>
  );
}
