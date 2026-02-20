"use client";

import { useRef, useEffect, type KeyboardEvent } from "react";

export default function SearchBar({
  value,
  onChange,
  onSubmit,
  loading,
  showSend,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  loading: boolean;
  showSend?: boolean;
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
          if (e.key === "Enter" && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
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
      <div className="absolute right-0 top-0 bottom-0 flex items-center gap-1 pr-4">
        {loading ? (
          <div className="w-5 h-5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
        ) : (
          <>
            {value && (
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
            )}
            {showSend && value && onSubmit && (
              <button
                type="button"
                onClick={onSubmit}
                className="flex items-center justify-center w-7 h-7 rounded-md bg-gray-700 dark:bg-gray-300 text-white dark:text-gray-900 hover:bg-gray-900 dark:hover:bg-white cursor-pointer transition-colors ml-1"
                aria-label="Send"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>
    </div>
    </div>
  );
}
