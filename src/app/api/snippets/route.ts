import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { parseQuery } from "@/lib/parseQuery";
import type { SermonSnippet } from "@/lib/types";

const DATA_DIR = join(process.cwd(), "data", "sermons");

function extractSnippets(
  transcript: string,
  needles: string[],
  maxSnippets: number
): SermonSnippet[] {
  const CONTEXT_CHARS = 120;
  const MAX_SNIPPET_CHARS = 300;
  const cleaned = transcript.replace(/\n+/g, " ");
  const lower = cleaned.toLowerCase();

  // Find all match positions for every needle (phrase or term)
  const allMatches: { index: number; length: number }[] = [];
  for (const needle of needles) {
    let pos = 0;
    while (pos < lower.length) {
      const idx = lower.indexOf(needle, pos);
      if (idx === -1) break;
      allMatches.push({ index: idx, length: needle.length });
      pos = idx + 1;
    }
  }

  if (allMatches.length === 0) return [];
  allMatches.sort((a, b) => a.index - b.index);

  // Build context windows, merging overlapping ones (capped at MAX_SNIPPET_CHARS)
  const windows: {
    start: number;
    end: number;
    matches: { index: number; length: number }[];
  }[] = [];

  for (const match of allMatches) {
    const winStart = Math.max(0, match.index - CONTEXT_CHARS);
    const winEnd = Math.min(
      cleaned.length,
      match.index + match.length + CONTEXT_CHARS
    );

    const last = windows[windows.length - 1];
    if (last && winStart <= last.end) {
      const mergedEnd = Math.max(last.end, winEnd);
      // Only merge if the resulting snippet stays within the size limit
      if (mergedEnd - last.start <= MAX_SNIPPET_CHARS) {
        last.end = mergedEnd;
        last.matches.push(match);
      } else {
        windows.push({ start: winStart, end: winEnd, matches: [match] });
      }
    } else {
      windows.push({ start: winStart, end: winEnd, matches: [match] });
    }
  }

  // Snap to word boundaries
  for (const win of windows) {
    if (win.start > 0) {
      const spaceIdx = cleaned.indexOf(" ", win.start);
      if (spaceIdx !== -1 && spaceIdx < win.start + 20) {
        win.start = spaceIdx + 1;
      }
    }
    if (win.end < cleaned.length) {
      const spaceIdx = cleaned.lastIndexOf(" ", win.end);
      if (spaceIdx !== -1 && spaceIdx > win.end - 20) {
        win.end = spaceIdx;
      }
    }
  }

  return windows.slice(0, maxSnippets).map((win) => {
    const text = cleaned.slice(win.start, win.end);
    const matches = win.matches
      .map((m) => ({
        start: m.index - win.start,
        end: m.index - win.start + m.length,
      }))
      .filter((m) => m.start >= 0 && m.end <= text.length);
    return { text, matches };
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { ids, query } = body as { ids: unknown; query: unknown };

  if (!Array.isArray(ids) || typeof query !== "string" || !query.trim()) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { phrases, terms } = parseQuery(query);

  // All needles to search for (phrases searched as exact strings)
  const needles = [...phrases, ...terms];

  if (needles.length === 0) {
    return NextResponse.json({});
  }

  const hasPhrases = phrases.length > 0;
  const idsToCheck = ids as string[];

  const result: Record<string, SermonSnippet[]> = {};

  if (hasPhrases) {
    // Phrase search — process all IDs concurrently with async reads
    const BATCH = 100;
    for (let i = 0; i < idsToCheck.length; i += BATCH) {
      const batch = idsToCheck.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (id) => {
          const safeId = String(id).replace(/[^a-zA-Z0-9-]/g, "");
          try {
            const raw = await readFile(join(DATA_DIR, `${safeId}.json`), "utf-8");
            const sermon = JSON.parse(raw);
            const transcript: string = sermon.transcript || "";
            const lowerTranscript = transcript.replace(/\n+/g, " ").toLowerCase();

            const moreInfo: string = sermon.moreInfoText || "";
            const lowerMoreInfo = moreInfo.replace(/\n+/g, " ").toLowerCase();

            const hasAll = phrases.every((p) => lowerTranscript.includes(p) || lowerMoreInfo.includes(p));
            if (!hasAll) {
              result[id] = [];
              return;
            }
            result[id] = extractSnippets(transcript, needles, 2);
            // Fall back to moreInfoText when transcript has no matches
            if (result[id].length === 0 && moreInfo) {
              result[id] = extractSnippets(moreInfo, needles, 2);
            }
          } catch {
            result[id] = [];
          }
        })
      );
    }
  } else {
    // Non-phrase search — synchronous, limited to SNIPPET_LIMIT
    for (const id of idsToCheck) {
      const safeId = String(id).replace(/[^a-zA-Z0-9-]/g, "");
      try {
        const raw = readFileSync(join(DATA_DIR, `${safeId}.json`), "utf-8");
        const sermon = JSON.parse(raw);
        const transcript: string = sermon.transcript || "";
        result[id] = extractSnippets(transcript, needles, 2);
        // Fall back to moreInfoText when transcript has no matches
        if (result[id].length === 0) {
          const moreInfo: string = sermon.moreInfoText || "";
          if (moreInfo) {
            result[id] = extractSnippets(moreInfo, needles, 2);
          }
        }
      } catch {
        result[id] = [];
      }
    }
  }

  return NextResponse.json(result);
}
