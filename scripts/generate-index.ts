import "dotenv/config";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { gzipSync } from "zlib";
import FlexSearch from "flexsearch";
import type { SermonData, SermonMeta } from "../src/lib/types";

const DATA_DIR = join(process.cwd(), "data", "sermons");
const PUBLIC_DIR = join(process.cwd(), "public");
const SERIES_CACHE = join(process.cwd(), "data", "series-names.json");
const API_BASE = "https://api.sermonaudio.com/v2/node";
const API_KEY = process.env.SERMONAUDIO_API_KEY!;
const BROADCASTER_ID = process.env.SERMONAUDIO_BROADCASTER_ID!;

function loadCachedSeriesNames(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(SERIES_CACHE, "utf-8"));
  } catch {
    return {};
  }
}

async function fetchSeriesNames(): Promise<Record<string, string>> {
  if (!API_KEY || !BROADCASTER_ID) {
    console.warn("Missing API credentials, using cached series names");
    return loadCachedSeriesNames();
  }

  const mapping: Record<string, string> = {};
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const url = `${API_BASE}/broadcasters/${BROADCASTER_ID}/series?pageSize=100&page=${page}`;
    const res = await fetch(url, { headers: { "X-Api-Key": API_KEY } });
    if (!res.ok) {
      console.warn(`Series API error ${res.status}, stopping fetch`);
      break;
    }
    const data = await res.json();
    for (const s of data.results ?? []) {
      if (s.seriesID && s.title) {
        mapping[String(s.seriesID)] = s.title;
      }
    }
    hasMore = data.next !== null;
    page++;
  }

  if (Object.keys(mapping).length > 0) {
    writeFileSync(SERIES_CACHE, JSON.stringify(mapping, null, 2));
    console.log(`  Fetched ${Object.keys(mapping).length} series names from API (cached to data/series-names.json)`);
  } else {
    console.warn("  API returned no series, falling back to cache");
    return loadCachedSeriesNames();
  }
  return mapping;
}

function loadSermons(): SermonData[] {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  console.log(`Loading ${files.length} sermon files...`);
  return files.map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf-8")));
}

async function generateIndex() {
  const sermons = loadSermons();

  // Build FlexSearch Document index
  const index = new FlexSearch.Document<SermonMeta>({
    document: {
      id: "id",
      index: [
        {
          field: "title",
          tokenize: "forward",
          resolution: 9,
        },
        {
          field: "preacher",
          tokenize: "forward",
          resolution: 5,
        },
        {
          field: "bibleText",
          tokenize: "forward",
          resolution: 7,
        },
        {
          field: "keywords",
          tokenize: "forward",
          resolution: 6,
        },
        {
          field: "moreInfoText",
          tokenize: "forward",
          resolution: 7,
        },
      ],
    },
  });

  // We also build a separate plain Index for transcript full-text search
  const transcriptIndex = new FlexSearch.Index({
    tokenize: "forward",
    resolution: 9,
    context: {
      depth: 2,
      bidirectional: true,
      resolution: 9,
    },
  });

  // Fetch series names early so we can resolve IDs in metadata
  const seriesNameMap = await fetchSeriesNames();

  const metadata: SermonMeta[] = [];

  for (const sermon of sermons) {
    const meta: SermonMeta = {
      id: sermon.sermonID,
      title: sermon.title,
      displayTitle: sermon.displayTitle,
      preacher: sermon.preacher,
      preachDate: sermon.preachDate,
      bibleText: sermon.bibleText,
      series: sermon.series ? (seriesNameMap[sermon.series] || null) : null,
      eventType: sermon.eventType,
      keywords: sermon.keywords,
      moreInfoText: sermon.moreInfoText,
    };

    index.add(meta);
    transcriptIndex.add(sermon.sermonID as unknown as number, sermon.transcript);
    metadata.push(meta);
  }

  // Sort metadata by date (newest first), with PM before AM on the same date
  const eventOrder = (e: string | null) => (e === "Sunday - PM" ? 1 : 0);
  metadata.sort((a, b) => {
    if (!a.preachDate && !b.preachDate) return 0;
    if (!a.preachDate) return 1;
    if (!b.preachDate) return -1;
    const diff = new Date(b.preachDate).getTime() - new Date(a.preachDate).getTime();
    if (diff !== 0) return diff;
    return eventOrder(b.eventType) - eventOrder(a.eventType);
  });

  // Export FlexSearch indexes
  const exportedDocIndex: Record<string, string> = {};
  index.export((key: string, data: string) => {
    exportedDocIndex[key] = data;
  });

  const exportedTranscriptIndex: Record<string, string> = {};
  transcriptIndex.export((key: string, data: string) => {
    exportedTranscriptIndex[key] = data;
  });

  // Write the search index bundle as gzipped JSON
  const searchBundle = {
    metadata,
    docIndex: exportedDocIndex,
    transcriptIndex: exportedTranscriptIndex,
  };

  const json = JSON.stringify(searchBundle);
  const gzipped = gzipSync(Buffer.from(json));
  writeFileSync(join(PUBLIC_DIR, "search-index.json.gz"), gzipped);

  const rawKB = (Buffer.byteLength(json) / 1024).toFixed(1);
  const gzKB = (gzipped.length / 1024).toFixed(1);
  console.log(`Generated search index: ${rawKB} KB raw, ${gzKB} KB gzipped`);
  console.log(`  Sermons indexed: ${metadata.length}`);
  console.log(`  Individual sermon files: ${sermons.length}`);

  // Extract unique preachers and event types from metadata
  const preachers = [...new Set(metadata.map((s) => s.preacher))].sort();
  const eventTypes = [
    ...new Set(metadata.map((s) => s.eventType).filter(Boolean)),
  ].sort() as string[];

  const series = [
    ...new Set(metadata.map((s) => s.series).filter(Boolean)),
  ].sort((a, b) => (a as string).localeCompare(b as string)) as string[];

  const keywords = [
    ...new Set(
      metadata
        .map((s) => s.keywords)
        .filter(Boolean)
        .flatMap((kw) => (kw as string).split(/\s+/))
        .map((kw) => kw.trim())
        .filter((kw) => kw.length > 0)
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  writeFileSync(
    join(PUBLIC_DIR, "filters.json"),
    JSON.stringify({ preachers, series, eventTypes, keywords })
  );
  console.log(`  Preachers: ${preachers.length}, Series: ${series.length}, Event types: ${eventTypes.length}, Keywords: ${keywords.length}`);
}

generateIndex().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
