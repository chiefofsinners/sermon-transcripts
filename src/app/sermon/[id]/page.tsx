import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { notFound } from "next/navigation";
import BackToSearch from "@/components/BackToSearch";
import HighlightText from "@/components/HighlightText";
import ReadingSettingsProvider from "@/components/ReadingSettingsProvider";
import SermonHeader from "@/components/SermonHeader";
import type { SermonData } from "@/lib/types";

const DATA_DIR = join(process.cwd(), "data", "sermons");

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export const dynamicParams = false;

export function generateStaticParams() {
  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ id: f.replace(".json", "") }));
}

export default async function SermonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let sermon: SermonData;
  try {
    const raw = readFileSync(join(DATA_DIR, `${id}.json`), "utf-8");
    sermon = JSON.parse(raw);
  } catch {
    notFound();
  }

  const title = sermon.title || sermon.displayTitle;

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <ReadingSettingsProvider>
        <SermonHeader title={title} />
        <BackToSearch sermonId={id} />
        <div className="max-w-3xl mx-auto px-4 pt-24 pb-12 animate-fade-in">
          <article>
            <header className="mb-8">
            <h1 className="text-[1.5em] font-bold text-gray-900 dark:text-gray-100 mb-3">
              <HighlightText text={title} />
            </h1>
            {sermon.subtitle && (
              <p className="text-[1.1em] text-gray-600 dark:text-gray-400 mb-3">
                <HighlightText text={sermon.subtitle} />
              </p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[0.875em] text-gray-500 dark:text-gray-400">
              <span className="font-medium"><HighlightText text={sermon.preacher} /></span>
              {sermon.preachDate && (
                <span>{formatDate(sermon.preachDate)}</span>
              )}
              {sermon.eventType && <span>{sermon.eventType}</span>}
            </div>
            {sermon.bibleText && (
              <p className="mt-2 text-gray-700 dark:text-gray-300 font-medium">
                <HighlightText text={sermon.bibleText} />
              </p>
            )}
            {sermon.keywords && (
              <div className="mt-3 flex flex-wrap gap-2">
                {sermon.keywords.split(/\s+/).map((kw) => (
                  <span
                    key={kw.trim()}
                    className="px-2 py-0.5 text-[0.75em] bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded"
                  >
                    {kw.trim()}
                  </span>
                ))}
              </div>
            )}
            {sermon.moreInfoText && (
              <p className="mt-4 text-[0.875em] text-gray-600 dark:text-gray-400 leading-relaxed italic">
                <HighlightText text={sermon.moreInfoText} />
              </p>
            )}
          </header>

          <div className="prose prose-gray max-w-none">
            {sermon.transcript.split("\n").map((paragraph, i) =>
              paragraph.trim() ? (
                <p key={i} className="mb-4 text-gray-800 dark:text-gray-200 leading-relaxed text-justify">
                  <HighlightText text={paragraph} />
                </p>
              ) : null
            )}
          </div>
        </article>
      </div>
      </ReadingSettingsProvider>
    </main>
  );
}
