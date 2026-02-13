import Link from "next/link";
import type { SermonMeta } from "@/lib/types";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function SermonCard({ sermon }: { sermon: SermonMeta }) {
  return (
    <Link
      href={`/sermon/${sermon.id}`}
      className="block p-5 border border-gray-300 dark:border-gray-700 rounded-lg hover:border-gray-400 dark:hover:border-gray-500 hover:shadow-sm transition-all bg-gray-200 dark:bg-gray-900"
    >
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 leading-snug">
        {sermon.title || sermon.displayTitle}
      </h3>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
        <span>{sermon.preacher}</span>
        {sermon.preachDate && (
          <span>
            {formatDate(sermon.preachDate)}
            {sermon.eventType === "Sunday - AM" && " (AM)"}
            {sermon.eventType === "Sunday - PM" && " (PM)"}
            {sermon.eventType === "Other" && " (Other)"}
          </span>
        )}
        {sermon.bibleText && (
          <span className="text-gray-700 dark:text-gray-300 font-medium">{sermon.bibleText}</span>
        )}
      </div>
      {sermon.series && (
        <div className="mt-1.5 text-xs text-gray-500">
          Series: {sermon.series}
        </div>
      )}
    </Link>
  );
}
