export type SearchMode = "all" | "any" | "exact" | "ai";

export interface SermonMeta {
  [key: string]: string | number | boolean | null;
  id: string;
  title: string;
  displayTitle: string;
  preacher: string;
  preachDate: string | null;
  bibleText: string | null;
  series: string | null;
  eventType: string | null;
  keywords: string | null;
  moreInfoText: string | null;
}

export interface SermonDetail extends SermonMeta {
  subtitle: string | null;
  moreInfoText: string | null;
  transcript: string;
}

export interface SermonData {
  sermonID: string;
  title: string;
  displayTitle: string;
  preacher: string;
  preacherID: number;
  preachDate: string | null;
  bibleText: string | null;
  series: string | null;
  eventType: string | null;
  keywords: string | null;
  subtitle: string | null;
  moreInfoText: string | null;
  transcript: string;
}

export interface SearchResult {
  id: string;
  field: string;
  result: string[];
}

export interface SnippetMatch {
  start: number;
  end: number;
}

export interface SermonSnippet {
  text: string;
  matches: SnippetMatch[];
}
