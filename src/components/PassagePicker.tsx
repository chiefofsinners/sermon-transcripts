"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  BIBLE_BOOKS,
  countMatchingSermons,
  parsePassageFilter,
  type BibleIndex,
} from "@/lib/bible";

const gridBtnBase =
  "py-2 px-2 rounded-lg text-sm font-medium transition-colors cursor-pointer text-center";
const gridBtnOff =
  "bg-gray-300 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-400 dark:hover:bg-gray-700";
const gridBtnOn =
  "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900";

function displayName(name: string): string {
  return BIBLE_BOOKS.find((b) => b.name === name)?.displayName ?? name;
}

function shortName(name: string): string {
  // Numbered books: "1 Corinthians" → "1 Cor"
  const m = name.match(/^(\d)\s+(.+)/);
  if (m) return `${m[1]} ${m[2].slice(0, 3)}`;
  // "Song of Solomon" → "Song"
  if (name.includes(" ")) return name.split(" ")[0];
  return name.slice(0, 4);
}

function BackArrow() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 19.5L8.25 12l7.5-7.5"
      />
    </svg>
  );
}

export default function PassagePicker({
  open,
  currentPassage,
  bibleIndex,
  onSelect,
  onClose,
}: {
  open: boolean;
  currentPassage: string;
  bibleIndex: BibleIndex;
  onSelect: (passage: string) => void;
  onClose: () => void;
}) {
  // Initialise from currentPassage
  const initial = useMemo(() => {
    if (!currentPassage) return { book: null as string | null, chapter: null as number | null };
    const parsed = parsePassageFilter(currentPassage);
    return {
      book: parsed.book,
      chapter: parsed.chapter ?? null,
    };
  }, [currentPassage]);

  const [selectedBook, setSelectedBook] = useState<string | null>(initial.book);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(initial.chapter);
  const [selectedVerse, setSelectedVerse] = useState<number | null>(null);

  // Reset state when modal opens/closes or currentPassage changes
  useEffect(() => {
    if (open) {
      const parsed = currentPassage ? parsePassageFilter(currentPassage) : null;
      setSelectedBook(parsed?.book ?? null);
      setSelectedChapter(parsed?.chapter ?? null);
      setSelectedVerse(null);
    }
  }, [open, currentPassage]);

  // Escape key closes modal
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const handleGo = useCallback(() => {
    if (!selectedBook) return;
    let passage = selectedBook;
    if (selectedChapter !== null) {
      passage += ` ${selectedChapter}`;
      if (selectedVerse !== null) {
        passage += `:${selectedVerse}`;
      }
    }
    onSelect(passage);
    onClose();
  }, [selectedBook, selectedChapter, selectedVerse, onSelect, onClose]);

  const handleBack = useCallback(() => {
    if (selectedChapter !== null) {
      setSelectedChapter(null);
      setSelectedVerse(null);
    } else {
      setSelectedBook(null);
    }
  }, [selectedChapter]);

  const chapters = useMemo(() => {
    if (!selectedBook) return [];
    const chapterMap = bibleIndex.books.get(selectedBook);
    if (!chapterMap) return [];
    return [...chapterMap.keys()].sort((a, b) => a - b);
  }, [selectedBook, bibleIndex]);

  const verses = useMemo(() => {
    if (!selectedBook || selectedChapter === null) return [];
    const chapterMap = bibleIndex.books.get(selectedBook);
    if (!chapterMap) return [];
    const verseSet = chapterMap.get(selectedChapter);
    if (!verseSet) return [];
    return [...verseSet].sort((a, b) => a - b);
  }, [selectedBook, selectedChapter, bibleIndex]);

  const sermonCount = useMemo(() => {
    if (!selectedBook) return 0;
    return countMatchingSermons(
      bibleIndex,
      selectedBook,
      selectedChapter ?? undefined,
      selectedVerse ?? undefined,
    );
  }, [bibleIndex, selectedBook, selectedChapter, selectedVerse]);

  const goLabel = useMemo(() => {
    if (!selectedBook) return "";
    const n = sermonCount;
    const s = n === 1 ? "sermon" : "sermons";
    if (selectedVerse !== null) {
      return `Show ${n} ${s} for ${selectedBook} ${selectedChapter}:${selectedVerse}`;
    }
    if (selectedChapter !== null) {
      return `Show ${n} ${s} in ${selectedBook} ${selectedChapter}`;
    }
    return `Show ${n} ${s} in ${displayName(selectedBook)}`;
  }, [selectedBook, selectedChapter, selectedVerse, sermonCount]);

  if (!open) return null;

  const otBooks = BIBLE_BOOKS.filter(
    (b) => b.testament === "OT" && bibleIndex.books.has(b.name),
  );
  const ntBooks = BIBLE_BOOKS.filter(
    (b) => b.testament === "NT" && bibleIndex.books.has(b.name),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-100 dark:bg-gray-900 rounded-2xl w-full max-w-lg sm:max-w-2xl mx-4 shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center p-6 pb-4 shrink-0">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {selectedBook === null
              ? "Select Passage"
              : selectedChapter === null
                ? displayName(selectedBook)
                : `${selectedBook} ${selectedChapter}`}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-6 pb-6 scrollbar-hide" style={{ scrollbarWidth: "none" }}>

        {/* Book Grid */}
        {selectedBook === null && (
          <>
            {otBooks.length > 0 && (
              <>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                  Old Testament
                </h3>
                <div className={`grid grid-cols-3 sm:grid-cols-4 gap-2${ntBooks.length > 0 ? " mb-5" : ""}`}>
                  {otBooks.map((b) => (
                    <button
                      key={b.name}
                      onClick={() => setSelectedBook(b.name)}
                      className={`${gridBtnBase} ${gridBtnOff}`}
                    >
                      <span className="sm:hidden">{shortName(b.displayName ?? b.name)}</span>
                      <span className="hidden sm:inline">{b.displayName ?? b.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {ntBooks.length > 0 && (
              <>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                  New Testament
                </h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {ntBooks.map((b) => (
                    <button
                      key={b.name}
                      onClick={() => setSelectedBook(b.name)}
                      className={`${gridBtnBase} ${gridBtnOff}`}
                    >
                      <span className="sm:hidden">{shortName(b.displayName ?? b.name)}</span>
                      <span className="hidden sm:inline">{b.displayName ?? b.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* Chapter Grid */}
        {selectedBook !== null && selectedChapter === null && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={handleBack}
                className="p-1 rounded-md text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              >
                <BackArrow />
              </button>
            </div>

            <button
              onClick={handleGo}
              className="w-full py-2.5 rounded-lg text-sm font-semibold bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-100 hover:bg-gray-400 dark:hover:bg-gray-600 cursor-pointer transition-colors mb-4"
            >
              {goLabel}
            </button>

            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Chapter
            </h3>
            <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
              {chapters.map((ch) => (
                <button
                  key={ch}
                  onClick={() => setSelectedChapter(ch)}
                  className={`${gridBtnBase} ${gridBtnOff}`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Verse Grid */}
        {selectedBook !== null && selectedChapter !== null && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={handleBack}
                className="p-1 rounded-md text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors cursor-pointer"
              >
                <BackArrow />
              </button>
            </div>

            <button
              onClick={handleGo}
              className="w-full py-2.5 rounded-lg text-sm font-semibold bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-100 hover:bg-gray-400 dark:hover:bg-gray-600 cursor-pointer transition-colors mb-4"
            >
              {goLabel}
            </button>

            {verses.length > 0 && (
              <>
                <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                  Verse
                </h3>
                <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                  {verses.map((v) => (
                    <button
                      key={v}
                      onClick={() =>
                        setSelectedVerse(selectedVerse === v ? null : v)
                      }
                      className={`${gridBtnBase} ${
                        selectedVerse === v ? gridBtnOn : gridBtnOff
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
      </div>
    </div>
  );
}
