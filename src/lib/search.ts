"use client";

import type { Document as FlexDocument, Index as FlexIndex } from "flexsearch";
import type { SermonMeta } from "./types";
import { parseQuery } from "./parseQuery";

interface SearchBundle {
  metadata: SermonMeta[];
  docIndex: Record<string, string>;
  transcriptIndex: Record<string, string>;
}

let docIndex: FlexDocument<SermonMeta> | null = null;
let transcriptIndex: FlexIndex | null = null;
let metadataMap: Map<string, SermonMeta> = new Map();
let allMetadata: SermonMeta[] = [];
let loaded = false;
let loading: Promise<void> | null = null;

export async function loadSearchIndex(): Promise<void> {
  if (loaded) return;
  if (loading) return loading;

  loading = (async () => {
    const [{ Document, Index }, res] = await Promise.all([
      import("flexsearch"),
      fetch("/search-index.json.gz"),
    ]);

    if (!res.ok) throw new Error(`Failed to fetch search index: ${res.status}`);

    const ds = new DecompressionStream("gzip");
    const decompressed = res.body!.pipeThrough(ds);
    const text = await new Response(decompressed).text();
    const bundle: SearchBundle = JSON.parse(text);

    allMetadata = bundle.metadata;
    metadataMap = new Map(bundle.metadata.map((s) => [s.id, s]));

    docIndex = new Document<SermonMeta>({
      document: {
        id: "id",
        index: [
          { field: "title", tokenize: "forward", resolution: 9 },
          { field: "preacher", tokenize: "forward", resolution: 5 },
          { field: "bibleText", tokenize: "forward", resolution: 7 },
          { field: "keywords", tokenize: "forward", resolution: 6 },
          { field: "moreInfoText", tokenize: "forward", resolution: 7 },
        ],
      },
    });

    for (const [key, data] of Object.entries(bundle.docIndex)) {
      if (data !== undefined) {
        docIndex.import(key, data);
      }
    }

    transcriptIndex = new Index({
      tokenize: "forward",
      resolution: 9,
      context: {
        depth: 2,
        bidirectional: true,
        resolution: 9,
      },
    });

    for (const [key, data] of Object.entries(bundle.transcriptIndex)) {
      if (data !== undefined) {
        transcriptIndex.import(key, data);
      }
    }

    loaded = true;
  })();

  return loading;
}

export function getAllSermons(): SermonMeta[] {
  return allMetadata;
}

export function search(query: string): SermonMeta[] {
  if (!docIndex || !transcriptIndex) return [];

  const resultIds = new Set<string>();
  const limit = allMetadata.length;

  const docResults = docIndex.search(query, { limit });
  for (const fieldResult of docResults) {
    for (const id of fieldResult.result) {
      resultIds.add(String(id));
    }
  }

  const transcriptResults = transcriptIndex.search(query, { limit });
  for (const id of transcriptResults) {
    resultIds.add(String(id));
  }

  return Array.from(resultIds)
    .map((id) => metadataMap.get(id))
    .filter((s): s is SermonMeta => s !== undefined);
}

/** OR search: returns sermons matching any word or quoted phrase in the query. */
export function searchAny(query: string): SermonMeta[] {
  if (!docIndex || !transcriptIndex) return [];

  const { phrases, terms } = parseQuery(query);
  // Combine individual terms and whole phrases as separate search units
  const searchUnits = [...terms, ...phrases].filter((u) => u.length >= 2);
  if (searchUnits.length === 0) return [];
  if (searchUnits.length === 1) return search(searchUnits[0]);

  const limit = allMetadata.length;
  const resultIds = new Set<string>();

  for (const unit of searchUnits) {
    const docResults = docIndex.search(unit, { limit });
    for (const fieldResult of docResults) {
      for (const id of fieldResult.result) {
        resultIds.add(String(id));
      }
    }
    const transcriptResults = transcriptIndex.search(unit, { limit });
    for (const id of transcriptResults) {
      resultIds.add(String(id));
    }
  }

  return Array.from(resultIds)
    .map((id) => metadataMap.get(id))
    .filter((s): s is SermonMeta => s !== undefined);
}

/** AND search: returns only sermons matching every word in the query. */
export function searchAll(query: string): SermonMeta[] {
  if (!docIndex || !transcriptIndex) return [];

  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0) return [];
  if (words.length === 1) return search(query);

  const limit = allMetadata.length;

  const wordSets = words.map((word) => {
    const ids = new Set<string>();
    const docResults = docIndex!.search(word, { limit });
    for (const fieldResult of docResults) {
      for (const id of fieldResult.result) {
        ids.add(String(id));
      }
    }
    const transcriptResults = transcriptIndex!.search(word, { limit });
    for (const id of transcriptResults) {
      ids.add(String(id));
    }
    return ids;
  });

  let intersection = wordSets[0];
  for (let i = 1; i < wordSets.length; i++) {
    intersection = new Set([...intersection].filter((id) => wordSets[i].has(id)));
  }

  return Array.from(intersection)
    .map((id) => metadataMap.get(id))
    .filter((s): s is SermonMeta => s !== undefined);
}

export function isLoaded(): boolean {
  return loaded;
}
