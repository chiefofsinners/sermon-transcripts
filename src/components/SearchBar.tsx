"use client";

import { useRef, useEffect, useCallback, type KeyboardEvent } from "react";

export type ComboButton = "ai" | "word" | "both";

export default function SearchBar({
  value,
  onChange,
  onSubmit,
  onAiSubmit,
  onWordSearchSubmit,
  loading,
  showSend,
  showComboButtons,
  activeComboButton,
  onComboButtonChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  onAiSubmit?: () => void;
  onWordSearchSubmit?: () => void;
  loading: boolean;
  showSend?: boolean;
  showComboButtons?: boolean;
  activeComboButton?: ComboButton;
  onComboButtonChange?: (button: ComboButton) => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
    autoResize();
  }, [autoResize]);

  // Re-fit height when value changes externally (e.g. clear button)
  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  const hasButtons = showComboButtons;

  const comboBtn = (label: string, icon: React.ReactNode, id: ComboButton, onClick: () => void) => {
    const isActive = activeComboButton === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => {
          onComboButtonChange?.(id);
          onClick();
        }}
        title={label}
        className={`px-2.5 py-1.5 text-xs font-medium rounded-md cursor-pointer transition-colors whitespace-nowrap ${
          isActive
            ? "bg-gray-700 dark:bg-gray-300 text-white dark:text-gray-900 hover:bg-gray-900 dark:hover:bg-white"
            : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
        }`}
      >
        <span className="hidden sm:inline">{label}</span>
        <span className="sm:hidden">{icon}</span>
      </button>
    );
  };

  const aiIcon = (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456Z" />
    </svg>
  );
  const searchIcon = (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  );
  const bothIcon = (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z" />
    </svg>
  );

  return (
    <div className={`w-full ${showComboButtons ? "max-w-3xl" : "max-w-2xl"} mx-auto`}>
    <div className="relative">
      <textarea
        ref={inputRef}
        rows={1}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          autoResize();
        }}
        onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (showComboButtons && activeComboButton) {
              if (activeComboButton === "ai" && onAiSubmit) onAiSubmit();
              else if (activeComboButton === "word" && onWordSearchSubmit) onWordSearchSubmit();
              else if (onSubmit) onSubmit();
            } else if (onSubmit) {
              onSubmit();
            }
          }
          if (!showSend && !showComboButtons && (e.key === '"' || e.key === "'")) {
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
                autoResize();
              });
            }
          }
        }}
        placeholder={loading ? "Loading search index..." : showSend || showComboButtons ? "Ask a question..." : "Search sermons..."}
        disabled={loading}
        className={`w-full pl-5 ${hasButtons ? "pr-12 sm:pr-64" : showSend ? "pr-22" : "pr-12"} py-3.5 text-lg border border-gray-300 dark:border-gray-600 rounded-lg
                   focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent
                   bg-gray-100 dark:bg-gray-950 text-gray-900 dark:text-gray-100 placeholder-gray-500
                   resize-none overflow-hidden leading-normal`}
      />
      {/* Desktop: buttons inside the input */}
      <div className={`absolute right-0 top-0 bottom-0 ${hasButtons ? "hidden sm:flex" : "flex"} items-center gap-1.5 pr-3`}>
        {loading ? (
          <div className="w-5 h-5 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
        ) : (
          <>
            {hasButtons && onAiSubmit && onWordSearchSubmit && onSubmit && (
              <>
                {comboBtn("Ask AI", aiIcon, "ai", onAiSubmit)}
                {comboBtn("Word Search", searchIcon, "word", onWordSearchSubmit)}
                {comboBtn("Both", bothIcon, "both", onSubmit)}
              </>
            )}
            {showSend && !showComboButtons && value && onSubmit && (
              <button
                type="button"
                onClick={onSubmit}
                className="flex items-center justify-center w-7 h-7 rounded-md bg-gray-400 dark:bg-gray-300 text-white dark:text-gray-900 hover:bg-gray-500 dark:hover:bg-white cursor-pointer transition-colors"
                aria-label="Send"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
                </svg>
              </button>
            )}
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  inputRef.current?.focus();
                }}
                className="flex items-center justify-center w-5 h-5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 cursor-pointer ml-1"
                aria-label="Clear search"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>
      {/* Mobile: clear button inside input */}
      {hasButtons && !loading && value && (
        <div className="absolute right-0 top-0 bottom-0 flex sm:hidden items-center pr-3">
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
        </div>
      )}
    </div>
      {/* Mobile: buttons below the input */}
      {hasButtons && onAiSubmit && onWordSearchSubmit && onSubmit && (
        <div className="flex sm:hidden justify-end gap-1.5 mt-2">
          {comboBtn("Ask AI", aiIcon, "ai", onAiSubmit)}
          {comboBtn("Word Search", searchIcon, "word", onWordSearchSubmit)}
          {comboBtn("Both", bothIcon, "both", onSubmit)}
        </div>
      )}
    </div>
  );
}
