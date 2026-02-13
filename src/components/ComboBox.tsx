"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface ComboBoxProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}

export default function ComboBox({
  id,
  value,
  onChange,
  options,
  placeholder,
  className = "",
}: ComboBoxProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = value.trim()
    ? options.filter((o) => o.toLowerCase().includes(value.toLowerCase()))
    : options;

  const isExactMatch =
    filtered.length === 1 && filtered[0].toLowerCase() === value.toLowerCase();

  const showDropdown = open && filtered.length > 0 && !isExactMatch;

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[focusedIndex] as HTMLElement;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);

  const select = useCallback(
    (val: string) => {
      onChange(val);
      setOpen(false);
      setFocusedIndex(-1);
      inputRef.current?.blur();
    },
    [onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        setOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setFocusedIndex((i) => (i + 1) % filtered.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedIndex((i) => (i - 1 + filtered.length) % filtered.length);
        break;
      case "Enter":
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < filtered.length) {
          select(filtered[focusedIndex]);
        }
        break;
      case "Escape":
        setOpen(false);
        setFocusedIndex(-1);
        break;
      case "Tab":
        setOpen(false);
        setFocusedIndex(-1);
        break;
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setFocusedIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={className}
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-controls={id ? `${id}-listbox` : undefined}
          autoComplete="off"
        />
        {options.length > 0 && (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => {
              setOpen((o) => !o);
              inputRef.current?.focus();
            }}
            className="absolute inset-y-0 right-0 flex items-center pr-2 text-gray-400 dark:text-gray-500 cursor-pointer"
            aria-label="Toggle suggestions"
          >
            <svg
              className={`h-4 w-4 transition-transform ${showDropdown ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        )}
      </div>

      {showDropdown && (
        <ul
          ref={listRef}
          id={id ? `${id}-listbox` : undefined}
          role="listbox"
          className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 py-1 text-sm shadow-lg"
        >
          {filtered.map((option, i) => (
            <li
              key={option}
              role="option"
              aria-selected={i === focusedIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                select(option);
              }}
              onMouseEnter={() => setFocusedIndex(i)}
              className={`cursor-pointer select-none px-3 py-2 ${
                i === focusedIndex
                  ? "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  : "text-gray-700 dark:text-gray-300"
              }`}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
