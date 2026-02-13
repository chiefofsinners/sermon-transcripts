"use client";

import { useRef, useEffect, type KeyboardEvent } from "react";
import type { SearchMode } from "@/lib/types";

const MODES: { value: SearchMode; label: string }[] = [
  { value: "any", label: "Any word" },
  { value: "all", label: "All words" },
  { value: "exact", label: "Exact phrase" },
];

export default function SearchBar({
  value,
  onChange,
  loading,
  mode,
  onModeChange,
}: {
  value: string;
  onChange: (value: string) => void;
  loading: boolean;
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="w-full max-w-2xl mx-auto">
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === '"' || e.key === "'") {
            const quote = e.key;
            const input = e.currentTarget;
            const pos = input.selectionStart ?? value.length;
            // Only auto-close when typing a new opening quote, not when
            // the character after the cursor is already a closing quote
            if (value[pos] !== quote) {
              e.preventDefault();
              const before = value.slice(0, pos);
              const after = value.slice(pos);
              onChange(before + quote + quote + after);
              // Place cursor between the quotes after React re-renders
              requestAnimationFrame(() => {
                input.setSelectionRange(pos + 1, pos + 1);
              });
            }
          }
        }}
        placeholder={loading ? "Loading search index..." : "Search sermons..."}
        disabled={loading}
        className="w-full pl-5 pr-12 py-3.5 text-lg border border-gray-300 dark:border-gray-600 rounded-lg
                   focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent
                   bg-gray-100 dark:bg-gray-950 text-gray-900 dark:text-gray-100 placeholder-gray-500"
      />
      <div className="absolute right-0 top-0 bottom-0 flex items-center pr-4">
        {loading ? (
          <div className="w-5 h-5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
        ) : value ? (
          <button
            type="button"
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
            className="flex items-center justify-center w-5 h-5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 cursor-pointer"
            aria-label="Clear search"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
      <div className="flex justify-center gap-1 mt-2">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => onModeChange(m.value)}
            className={`px-3 py-1 text-xs rounded-full cursor-pointer transition-colors ${
              mode === m.value
                ? "bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
