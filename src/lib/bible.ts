import type { SermonMeta } from "./types";

export interface ParsedReference {
  book: string;
  chapter: number;
  verseStart: number | null;
  verseEnd: number | null;
}

export interface BibleIndex {
  books: Map<string, Map<number, Set<number>>>;
  sermonRefs: Map<string, ParsedReference[]>;
}

export const BIBLE_BOOKS: { name: string; displayName?: string; testament: "OT" | "NT" }[] = [
  { name: "Genesis", testament: "OT" },
  { name: "Exodus", testament: "OT" },
  { name: "Leviticus", testament: "OT" },
  { name: "Numbers", testament: "OT" },
  { name: "Deuteronomy", testament: "OT" },
  { name: "Joshua", testament: "OT" },
  { name: "Judges", testament: "OT" },
  { name: "Ruth", testament: "OT" },
  { name: "1 Samuel", testament: "OT" },
  { name: "2 Samuel", testament: "OT" },
  { name: "1 Kings", testament: "OT" },
  { name: "2 Kings", testament: "OT" },
  { name: "1 Chronicles", testament: "OT" },
  { name: "2 Chronicles", testament: "OT" },
  { name: "Ezra", testament: "OT" },
  { name: "Nehemiah", testament: "OT" },
  { name: "Esther", testament: "OT" },
  { name: "Job", testament: "OT" },
  { name: "Psalm", displayName: "Psalms", testament: "OT" },
  { name: "Proverbs", testament: "OT" },
  { name: "Ecclesiastes", testament: "OT" },
  { name: "Song of Solomon", testament: "OT" },
  { name: "Isaiah", testament: "OT" },
  { name: "Jeremiah", testament: "OT" },
  { name: "Lamentations", testament: "OT" },
  { name: "Ezekiel", testament: "OT" },
  { name: "Daniel", testament: "OT" },
  { name: "Hosea", testament: "OT" },
  { name: "Joel", testament: "OT" },
  { name: "Amos", testament: "OT" },
  { name: "Obadiah", testament: "OT" },
  { name: "Jonah", testament: "OT" },
  { name: "Micah", testament: "OT" },
  { name: "Nahum", testament: "OT" },
  { name: "Habakkuk", testament: "OT" },
  { name: "Zephaniah", testament: "OT" },
  { name: "Haggai", testament: "OT" },
  { name: "Zechariah", testament: "OT" },
  { name: "Malachi", testament: "OT" },
  { name: "Matthew", testament: "NT" },
  { name: "Mark", testament: "NT" },
  { name: "Luke", testament: "NT" },
  { name: "John", testament: "NT" },
  { name: "Acts", testament: "NT" },
  { name: "Romans", testament: "NT" },
  { name: "1 Corinthians", testament: "NT" },
  { name: "2 Corinthians", testament: "NT" },
  { name: "Galatians", testament: "NT" },
  { name: "Ephesians", testament: "NT" },
  { name: "Philippians", testament: "NT" },
  { name: "Colossians", testament: "NT" },
  { name: "1 Thessalonians", testament: "NT" },
  { name: "2 Thessalonians", testament: "NT" },
  { name: "1 Timothy", testament: "NT" },
  { name: "2 Timothy", testament: "NT" },
  { name: "Titus", testament: "NT" },
  { name: "Philemon", testament: "NT" },
  { name: "Hebrews", testament: "NT" },
  { name: "James", testament: "NT" },
  { name: "1 Peter", testament: "NT" },
  { name: "2 Peter", testament: "NT" },
  { name: "1 John", testament: "NT" },
  { name: "2 John", testament: "NT" },
  { name: "3 John", testament: "NT" },
  { name: "Jude", testament: "NT" },
  { name: "Revelation", testament: "NT" },
];

const TYPO_MAP: Record<string, string> = {
  "1 Corinthinas": "1 Corinthians",
  "Matthews": "Matthew",
};

// Regex: book name (may start with digit), chapter, optional chapter range OR optional :verse with optional verse/chapter range
const REF_PATTERN =
  /^(\d?\s?[A-Za-z]+(?: [A-Za-z]+)*?)\s+(\d+)(?:[-\u2013](\d+)|(?::(\d+)(?:[-\u2013](\d+)(?::(\d+))?)?))?$/;

function parseSingleReference(raw: string): ParsedReference[] {
  let text = raw.trim();
  if (!text) return [];

  // Fix known typos
  for (const [typo, fix] of Object.entries(TYPO_MAP)) {
    if (text.startsWith(typo)) {
      text = fix + text.slice(typo.length);
    }
  }

  // Normalise en-dash to hyphen
  text = text.replace(/\u2013/g, "-");

  const m = REF_PATTERN.exec(text);
  if (!m) return [];

  const book = m[1].trim();
  const chapter = parseInt(m[2], 10);
  const endChapterStr = m[3];  // chapter range, e.g. "Ezra 1-3" → "3"
  const verseStartStr = m[4];
  const endNumStr = m[5];
  const endVerseStr = m[6];

  // Chapter range like "Ezra 1-3"
  if (endChapterStr) {
    const endChapter = parseInt(endChapterStr, 10);
    const refs: ParsedReference[] = [];
    for (let ch = chapter; ch <= endChapter; ch++) {
      refs.push({ book, chapter: ch, verseStart: null, verseEnd: null });
    }
    return refs;
  }

  // No verse info — chapter-only reference
  if (!verseStartStr) {
    return [{ book, chapter, verseStart: null, verseEnd: null }];
  }

  const verseStart = parseInt(verseStartStr, 10);

  // No range — single verse
  if (!endNumStr) {
    return [{ book, chapter, verseStart, verseEnd: verseStart }];
  }

  // Cross-chapter range like "Judges 6:33-7:25" (endNumStr=7, endVerseStr=25)
  if (endVerseStr) {
    const endChapter = parseInt(endNumStr, 10);
    const endVerse = parseInt(endVerseStr, 10);
    return [
      { book, chapter, verseStart, verseEnd: null },
      { book, chapter: endChapter, verseStart: 1, verseEnd: endVerse },
    ];
  }

  // Same-chapter verse range like "Romans 10:1-17"
  const verseEnd = parseInt(endNumStr, 10);
  return [{ book, chapter, verseStart, verseEnd }];
}

const KNOWN_BOOKS = new Set(BIBLE_BOOKS.map((b) => b.name));

const CHAPTER_COUNTS: Record<string, number> = {
  Genesis: 50, Exodus: 40, Leviticus: 27, Numbers: 36, Deuteronomy: 34,
  Joshua: 24, Judges: 21, Ruth: 4, "1 Samuel": 31, "2 Samuel": 24,
  "1 Kings": 22, "2 Kings": 25, "1 Chronicles": 29, "2 Chronicles": 36,
  Ezra: 10, Nehemiah: 13, Esther: 10, Job: 42, Psalm: 150,
  Proverbs: 31, Ecclesiastes: 12, "Song of Solomon": 8, Isaiah: 66,
  Jeremiah: 52, Lamentations: 5, Ezekiel: 48, Daniel: 12, Hosea: 14,
  Joel: 3, Amos: 9, Obadiah: 1, Jonah: 4, Micah: 7, Nahum: 3,
  Habakkuk: 3, Zephaniah: 3, Haggai: 2, Zechariah: 14, Malachi: 4,
  Matthew: 28, Mark: 16, Luke: 24, John: 21, Acts: 28, Romans: 16,
  "1 Corinthians": 16, "2 Corinthians": 13, Galatians: 6, Ephesians: 6,
  Philippians: 4, Colossians: 4, "1 Thessalonians": 5, "2 Thessalonians": 3,
  "1 Timothy": 6, "2 Timothy": 4, Titus: 3, Philemon: 1, Hebrews: 13,
  James: 5, "1 Peter": 5, "2 Peter": 3, "1 John": 5, "2 John": 1,
  "3 John": 1, Jude: 1, Revelation: 22,
};

export function validateBibleText(input: string): { valid: boolean; errors: string[] } {
  if (!input.trim()) return { valid: true, errors: [] };

  const errors: string[] = [];
  const parts = input.split(";");

  for (const raw of parts) {
    let text = raw.trim();
    if (!text) continue;

    // Apply typo fixes (same logic as parseSingleReference)
    for (const [typo, fix] of Object.entries(TYPO_MAP)) {
      if (text.startsWith(typo)) {
        text = fix + text.slice(typo.length);
      }
    }

    text = text.replace(/\u2013/g, "-");

    // Allow whole-book references (just a book name, no chapter)
    if (KNOWN_BOOKS.has(text)) continue;

    const m = REF_PATTERN.exec(text);
    if (!m) {
      errors.push(`Invalid reference: "${raw.trim()}"`);
      continue;
    }

    const book = m[1].trim();
    if (!KNOWN_BOOKS.has(book)) {
      errors.push(`Unknown book: "${book}"`);
      continue;
    }

    const chapter = parseInt(m[2], 10);
    const maxChapter = CHAPTER_COUNTS[book];
    if (maxChapter && chapter > maxChapter) {
      errors.push(`${book} only has ${maxChapter} chapter${maxChapter > 1 ? "s" : ""}`);
    }

    // Validate end chapter in chapter range (e.g. "Ezra 1-3")
    const endChapterStr = m[3];
    if (endChapterStr) {
      const endChapter = parseInt(endChapterStr, 10);
      if (maxChapter && endChapter > maxChapter) {
        errors.push(`${book} only has ${maxChapter} chapter${maxChapter > 1 ? "s" : ""}`);
      }
      if (endChapter <= chapter) {
        errors.push(`End chapter must be greater than start chapter in "${raw.trim()}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function parseBibleText(bibleText: string | null): ParsedReference[] {
  if (!bibleText) return [];
  return bibleText
    .split(";")
    .flatMap((part) => parseSingleReference(part));
}

export function buildBibleIndex(sermons: SermonMeta[]): BibleIndex {
  const books = new Map<string, Map<number, Set<number>>>();
  const sermonRefs = new Map<string, ParsedReference[]>();

  for (const sermon of sermons) {
    const refs = parseBibleText(sermon.bibleText);
    if (refs.length === 0) continue;
    sermonRefs.set(sermon.id, refs);

    for (const ref of refs) {
      let chapters = books.get(ref.book);
      if (!chapters) {
        chapters = new Map();
        books.set(ref.book, chapters);
      }

      let verses = chapters.get(ref.chapter);
      if (!verses) {
        verses = new Set();
        chapters.set(ref.chapter, verses);
      }

      if (ref.verseStart !== null) {
        const end = ref.verseEnd ?? ref.verseStart;
        for (let v = ref.verseStart; v <= end; v++) {
          verses.add(v);
        }
      }
    }
  }

  return { books, sermonRefs };
}

export function matchesPassageFilter(
  refs: ParsedReference[],
  book: string,
  chapter?: number,
  verse?: number,
): boolean {
  return refs.some((ref) => {
    if (ref.book !== book) return false;
    if (chapter === undefined) return true;
    if (ref.chapter !== chapter) return false;
    if (verse === undefined) return true;

    // Chapter-only reference — matches any verse in that chapter
    if (ref.verseStart === null) return true;

    const end = ref.verseEnd ?? ref.verseStart;
    return verse >= ref.verseStart && verse <= end;
  });
}

export function parsePassageFilter(
  str: string,
): { book: string; chapter?: number; verse?: number } {
  // Formats: "John", "John 3", "John 3:16"
  const colonIdx = str.indexOf(":");
  if (colonIdx !== -1) {
    const verse = parseInt(str.slice(colonIdx + 1), 10);
    const beforeColon = str.slice(0, colonIdx);
    const spaceIdx = beforeColon.lastIndexOf(" ");
    const book = beforeColon.slice(0, spaceIdx);
    const chapter = parseInt(beforeColon.slice(spaceIdx + 1), 10);
    return { book, chapter, verse };
  }

  // Try to find a trailing number for chapter
  const match = str.match(/^(.+?)\s+(\d+)$/);
  if (match) {
    // But be careful with books like "1 Corinthians" — we need the book to be a known name
    const candidateBook = match[1];
    const candidateChapter = parseInt(match[2], 10);
    // Check if candidateBook is a real book name
    if (BIBLE_BOOKS.some((b) => b.name === candidateBook)) {
      return { book: candidateBook, chapter: candidateChapter };
    }
  }

  return { book: str };
}

export function countMatchingSermons(
  index: BibleIndex,
  book: string,
  chapter?: number,
  verse?: number,
): number {
  let count = 0;
  for (const [, refs] of index.sermonRefs) {
    if (matchesPassageFilter(refs, book, chapter, verse)) {
      count++;
    }
  }
  return count;
}
