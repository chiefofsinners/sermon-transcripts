import type { ReactNode } from "react";
import type { SermonMeta } from "@/lib/types";
import SermonCard from "./SermonCard";

export default function SermonList({
  sermons,
  totalCount,
  sortControl,
  pageSizeControl,
  twoColumn,
}: {
  sermons: SermonMeta[];
  totalCount: number;
  sortControl?: ReactNode;
  pageSizeControl?: ReactNode;
  twoColumn?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between pt-4 mb-4">
        <div className="flex items-center gap-4">
          <p className="text-base sm:text-sm text-gray-500 dark:text-gray-400">
            {totalCount.toLocaleString()} sermon{totalCount !== 1 ? "s" : ""}
          </p>
          {pageSizeControl}
        </div>
        {sortControl}
      </div>
      <div className={twoColumn ? "grid grid-cols-1 lg:grid-cols-2 gap-3" : "space-y-3"}>
        {sermons.map((sermon) => (
          <SermonCard key={sermon.id} sermon={sermon} />
        ))}
      </div>
    </div>
  );
}
