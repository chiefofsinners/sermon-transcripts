import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import BackToSearch from "@/components/BackToSearch";
import HighlightText from "@/components/HighlightText";
import ReadingSettingsProvider from "@/components/ReadingSettingsProvider";
import SermonHeader from "@/components/SermonHeader";
import type { SermonData } from "@/lib/types";
import { SITE_TITLE, CHURCH_NAME } from "@/lib/siteConfig";

const DATA_DIR = join(process.cwd(), "data", "sermons");
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

function loadSermon(id: string): SermonData | null {
  try {
    const raw = readFileSync(join(DATA_DIR, `${id}.json`), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const sermon = loadSermon(id);
  if (!sermon) return {};

  const title = sermon.title || sermon.displayTitle;
  const description = [
    sermon.bibleText && `Passage: ${sermon.bibleText}.`,
    `Preached by ${sermon.preacher}`,
    sermon.preachDate &&
      `on ${new Date(sermon.preachDate).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })}`,
    sermon.moreInfoText &&
      `— ${sermon.moreInfoText.slice(0, 200)}${sermon.moreInfoText.length > 200 ? "…" : ""}`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    title: `${title} — ${SITE_TITLE}`,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      ...(sermon.preachDate && { publishedTime: sermon.preachDate }),
      authors: [sermon.preacher],
    },
  };
}

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
  const sermon = loadSermon(id);
  if (!sermon) notFound();

  const title = sermon.title || sermon.displayTitle;

  const broadcasterId = process.env.SERMONAUDIO_BROADCASTER_ID;
  const listenUrl =
    broadcasterId && sermon.sermonID && /^\d+$/.test(sermon.sermonID)
      ? `https://www.sermonaudio.com/sermoninfo.asp?SID=${sermon.sermonID}`
      : undefined;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    ...(sermon.subtitle && { alternativeHeadline: sermon.subtitle }),
    author: {
      "@type": "Person",
      name: sermon.preacher,
    },
    publisher: {
      "@type": "Organization",
      name: CHURCH_NAME,
    },
    ...(sermon.preachDate && { datePublished: `${sermon.preachDate}T00:00:00Z` }),
    ...(sermon.bibleText && {
      about: {
        "@type": "Thing",
        name: sermon.bibleText,
      },
    }),
    ...(sermon.keywords && {
      keywords: sermon.keywords.split(/\s+/).join(", "),
    }),
    ...(sermon.moreInfoText && { description: sermon.moreInfoText }),
    url: `${SITE_URL}/sermon/${sermon.sermonID}`,
    isPartOf: {
      "@type": "WebSite",
      name: SITE_TITLE,
      url: SITE_URL,
    },
    ...(listenUrl && {
      associatedMedia: {
        "@type": "AudioObject",
        contentUrl: listenUrl,
        name: `${title} (Audio)`,
      },
    }),
  };

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <ReadingSettingsProvider>
        <SermonHeader title={title} listenUrl={listenUrl} />
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
