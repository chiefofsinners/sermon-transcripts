import "dotenv/config";
import { execFileSync } from "child_process";
import { writeFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { chunkTranscript, embeddingText } from "../src/lib/chunking";
import { embed } from "../src/lib/embeddings";
import type { SermonData } from "../src/lib/types";

// Re-fetch a single sermon from SermonAudio, overwrite its local JSON, then
// delete and regenerate its embeddings in Supabase. Use this when a sermon's
// metadata (e.g. title) has been edited on SermonAudio after it was first
// downloaded — `npm run download` skips sermons it already has, and
// `npm run generate-embeddings` skips chunk IDs that already exist, so neither
// picks up the change on its own.
//
// Usage: npm run fix-sermon <sermonID>

const API_BASE = "https://api.sermonaudio.com/v2/node";
const API_KEY = process.env.SERMONAUDIO_API_KEY!;
const DATA_DIR = join(process.cwd(), "data", "sermons");
const EMBEDDING_BATCH_SIZE = 96;
const UPSERT_BATCH_SIZE = 10;

const sermonID = process.argv[2];

if (!API_KEY) {
  console.error("Missing SERMONAUDIO_API_KEY in .env");
  process.exit(1);
}
if (!sermonID) {
  console.error("Usage: npm run fix-sermon <sermonID>");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function decodeHTMLEntities(text: string): string {
  return text
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

interface APISermon {
  sermonID: string;
  fullTitle: string;
  displayTitle: string;
  bibleText: string | null;
  subtitle: string | null;
  moreInfoText: string | null;
  eventType: string | null;
  keywords: string | null;
  preachDate: string | null;
  speaker: { displayName: string; speakerID: number };
  series: { seriesID: number } | null;
}

async function apiFetch(url: string) {
  const res = await fetch(url, { headers: { "X-Api-Key": API_KEY } });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function fetchTranscriptText(id: string): Promise<string> {
  const res = await fetch(`${API_BASE}/sermons/${id}/transcript`, {
    headers: { "X-Api-Key": API_KEY },
  });
  if (!res.ok) {
    console.warn(`  Failed to download transcript: ${res.status}`);
    return "";
  }
  const data = (await res.json()) as { content?: string };
  return data.content ?? "";
}

async function main() {
  // 1. Re-fetch metadata + transcript from SermonAudio.
  console.log(`Fetching sermon ${sermonID} from SermonAudio...`);
  const sermon: APISermon = await apiFetch(`${API_BASE}/sermons/${sermonID}`);
  const transcriptText = await fetchTranscriptText(sermonID);

  if (!transcriptText) {
    throw new Error("No transcript returned; aborting before touching anything.");
  }

  const decode = (s: string | null) => (s ? decodeHTMLEntities(s) : null);

  const sermonData: SermonData = {
    sermonID: sermon.sermonID,
    title: decodeHTMLEntities(sermon.fullTitle),
    displayTitle: decodeHTMLEntities(sermon.displayTitle),
    preacher: sermon.speaker?.displayName ?? "Unknown",
    preacherID: sermon.speaker?.speakerID ?? 0,
    preachDate: sermon.preachDate,
    bibleText: decode(sermon.bibleText),
    series: sermon.series ? String(sermon.series.seriesID) : null,
    eventType: decode(sermon.eventType),
    keywords: decode(sermon.keywords),
    subtitle: decode(sermon.subtitle),
    moreInfoText: decode(sermon.moreInfoText),
    transcript: transcriptText,
  };

  // 2. Overwrite the local JSON.
  const filePath = join(DATA_DIR, `${sermon.sermonID}.json`);
  writeFileSync(filePath, JSON.stringify(sermonData, null, 2));
  console.log(`Wrote ${filePath}`);
  console.log(`  Title: ${sermonData.title}`);

  // 3. Delete this sermon's existing chunks so they get re-embedded.
  console.log("Deleting existing chunks...");
  const { error: delError } = await supabase
    .from("sermon_chunks")
    .delete()
    .eq("sermon_id", sermon.sermonID);
  if (delError) throw new Error(`Delete error: ${delError.message}`);

  // 4. Upsert the parent sermon row (updates the stored title etc.).
  const { error: sermonError } = await supabase.from("sermons").upsert(
    {
      sermon_id: sermonData.sermonID,
      title: sermonData.title || sermonData.displayTitle,
      preacher: sermonData.preacher,
      preach_date: sermonData.preachDate || null,
      bible_text: sermonData.bibleText || null,
      series: sermonData.series || null,
      event_type: sermonData.eventType || null,
      keywords: sermonData.keywords || null,
      subtitle: sermonData.subtitle || null,
      transcript: sermonData.transcript,
    },
    { onConflict: "sermon_id" }
  );
  if (sermonError) throw new Error(`Sermon upsert error: ${sermonError.message}`);

  // 5. Re-chunk and re-embed.
  const metadata = {
    title: sermonData.title || sermonData.displayTitle,
    preacher: sermonData.preacher,
    bibleText: sermonData.bibleText || "",
    preachDate: sermonData.preachDate || "",
    series: sermonData.series || "",
    subtitle: sermonData.subtitle || "",
    keywords: sermonData.keywords || "",
  };

  const textChunks = chunkTranscript(sermonData.transcript);
  console.log(`Embedding ${textChunks.length} chunks...`);

  for (let i = 0; i < textChunks.length; i += EMBEDDING_BATCH_SIZE) {
    const slice = textChunks.slice(i, i + EMBEDDING_BATCH_SIZE);
    const inputs = slice.map((t) => embeddingText(metadata, t));
    const embeddings = await embed(inputs, "passage");

    for (let j = 0; j < slice.length; j += UPSERT_BATCH_SIZE) {
      const subStart = i + j;
      const rows = slice
        .slice(j, j + UPSERT_BATCH_SIZE)
        .map((text, k) => ({
          sermon_id: sermonData.sermonID,
          chunk_index: subStart + k,
          text,
          embedding: JSON.stringify(embeddings[j + k]),
        }));
      const { error } = await supabase
        .from("sermon_chunks")
        .upsert(rows, { onConflict: "sermon_id,chunk_index" });
      if (error) throw new Error(`Upsert error: ${error.message}`);
    }
  }

  console.log(`\nRe-indexed ${textChunks.length} chunks for ${sermonID}.`);

  // 6. Rebuild the client-side FlexSearch index so the new title shows there too.
  console.log("\nRegenerating search index...");
  execFileSync("tsx", [join(__dirname, "generate-index.ts")], {
    stdio: "inherit",
  });

  console.log(`\nDone! ${sermonID} fully refreshed.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
