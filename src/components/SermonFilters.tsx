import { useState, type ReactNode } from "react";
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from "@headlessui/react";
import PassagePicker from "./PassagePicker";
import DatePicker from "./DatePicker";
import { BIBLE_BOOKS, parsePassageFilter, type BibleIndex } from "@/lib/bible";

export type SortBy = "best-match" | "date-desc" | "date-asc" | "preacher-asc" | "title-asc";

export interface FilterOptions {
  preachers: string[];
  series: string[];
  keywords: string[];
  minDate?: string;
  maxDate?: string;
  availableDates?: Set<string>;
}

function passageDisplayLabel(passage: string): string {
  const parsed = parsePassageFilter(passage);
  if (parsed.chapter !== undefined) {
    // "Psalm 23", "Psalm 23:1" — use internal name for specific references
    let label = parsed.book + ` ${parsed.chapter}`;
    if (parsed.verse !== undefined) label += `:${parsed.verse}`;
    return label;
  }
  // Book only — use display name (e.g. "Psalms")
  return BIBLE_BOOKS.find((b) => b.name === parsed.book)?.displayName ?? parsed.book;
}

const allSortOptions: { value: SortBy; label: string }[] = [
  { value: "best-match", label: "Best match" },
  { value: "date-desc", label: "Newest first" },
  { value: "date-asc", label: "Oldest first" },
  { value: "preacher-asc", label: "Preacher A\u2013Z" },
  { value: "title-asc", label: "Title A\u2013Z" },
];

function ChevronDown() {
  return (
    <svg
      className="w-4 h-4 text-gray-500"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 8.25l-7.5 7.5-7.5-7.5"
      />
    </svg>
  );
}

function Check() {
  return (
    <svg
      className="w-4 h-4 text-gray-700 dark:text-gray-300"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.5 12.75l6 6 9-13.5"
      />
    </svg>
  );
}

const btnClass =
  "inline-flex items-center gap-2 px-3.5 py-2 text-base sm:px-3 sm:py-1.5 sm:text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-gray-200 dark:bg-gray-950 text-gray-700 dark:text-gray-300 shadow-sm hover:bg-gray-300 dark:hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent cursor-pointer";

const panelClass =
  "z-10 mt-1 rounded-md bg-gray-200 dark:bg-gray-950 shadow-lg ring-1 ring-black/5 dark:ring-white/10 focus:outline-none overflow-auto [--anchor-gap:4px] [--anchor-max-height:24rem] [--anchor-padding:16px]";

const optionClass =
  "flex items-center justify-between gap-2 px-3 py-2.5 text-base sm:py-2 sm:text-sm text-gray-700 dark:text-gray-300 cursor-pointer select-none data-[focus]:bg-gray-100 dark:data-[focus]:bg-gray-900 data-[focus]:text-gray-900 dark:data-[focus]:text-gray-100 data-[selected]:font-medium";

export function SortControl({
  sortBy,
  onSortChange,
  isSearching = false,
}: {
  sortBy: SortBy;
  onSortChange: (v: SortBy) => void;
  isSearching?: boolean;
}) {
  const sortOptions = isSearching
    ? allSortOptions
    : allSortOptions.filter((o) => o.value !== "best-match");
  return (
    <Listbox value={sortBy} onChange={onSortChange}>
      <ListboxButton className={btnClass}>
        <span className="truncate">
          {allSortOptions.find((o) => o.value === sortBy)?.label}
        </span>
        <ChevronDown />
      </ListboxButton>
      <ListboxOptions anchor="bottom end" transition className={`${panelClass} w-48 transition duration-100 ease-out data-closed:opacity-0 data-closed:scale-95`}>
        {sortOptions.map((o) => (
          <ListboxOption key={o.value} value={o.value} className={optionClass}>
            {o.label}
            <span className="w-4">{sortBy === o.value && <Check />}</span>
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  );
}

export default function SermonFilters({
  options,
  preacher,
  series,
  keyword,
  passage,
  dateFrom,
  dateTo,
  sortBy,
  bibleIndex,
  pickerBibleIndex,
  onSortChange,
  onPreacherChange,
  onSeriesChange,
  onKeywordChange,
  onPassageChange,
  onDateFromChange,
  onDateToChange,
  isSearching = false,
  toolbar,
}: {
  options: FilterOptions;
  preacher: string;
  series: string;
  keyword: string;
  passage: string;
  dateFrom: string;
  dateTo: string;
  sortBy: SortBy;
  bibleIndex: BibleIndex | null;
  pickerBibleIndex: BibleIndex | null;
  onSortChange: (v: SortBy) => void;
  onPreacherChange: (v: string) => void;
  onSeriesChange: (v: string) => void;
  onKeywordChange: (v: string) => void;
  onPassageChange: (v: string) => void;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  isSearching?: boolean;
  toolbar?: ReactNode;
}) {
  const [showPassagePicker, setShowPassagePicker] = useState(false);
  const [keywordQuery, setKeywordQuery] = useState("");

  const activeFilterCount = [preacher, series, keyword, passage, dateFrom, dateTo].filter(Boolean).length;
  const defaultSort = isSearching ? "best-match" : "date-desc";
  const hasActiveFilters = activeFilterCount > 0 || sortBy !== defaultSort;
  const [open, setOpen] = useState(hasActiveFilters);

  const MAX_VISIBLE = 50;
  const filteredKeywords = keywordQuery === ""
    ? options.keywords.slice(0, MAX_VISIBLE)
    : options.keywords.filter((kw) =>
        kw.toLowerCase().includes(keywordQuery.toLowerCase())
      ).slice(0, MAX_VISIBLE);
  const hasMoreKeywords = keywordQuery === ""
    ? options.keywords.length > MAX_VISIBLE
    : options.keywords.filter((kw) =>
        kw.toLowerCase().includes(keywordQuery.toLowerCase())
      ).length > MAX_VISIBLE;

  const handleClear = () => {
    onPreacherChange("");
    onSeriesChange("");
    onKeywordChange("");
    onPassageChange("");
    onDateFromChange("");
    onDateToChange("");
    onSortChange(isSearching ? "best-match" : "date-desc");
  };

  return (
    <div className={open ? "mb-2 sm:mb-3" : ""}>
      {/* Toolbar row: filter toggle left, mode pills / extras right */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1.5 px-2 py-2 text-base sm:py-1.5 sm:text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 cursor-pointer transition-colors shrink-0"
        >
          <svg className="w-5 h-5 sm:w-4 sm:h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" />
          </svg>
          <span className="hidden sm:inline">{open ? "Hide Filters" : "Show Filters"}</span>
          {activeFilterCount > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-medium rounded-full bg-gray-700 dark:bg-gray-300 text-white dark:text-gray-900">
              {activeFilterCount}
            </span>
          )}
          <svg
            className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2.5}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
        {toolbar}
      </div>

      {/* Filter controls (below toolbar when open) */}
      {open && (
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-2">
          {hasActiveFilters && (
            <button
              onClick={handleClear}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-base sm:px-3 sm:py-1.5 sm:text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer transition-colors rounded-md hover:bg-gray-200 dark:hover:bg-gray-800"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear
            </button>
          )}

          <Listbox value={preacher} onChange={onPreacherChange}>
            <ListboxButton className={btnClass}>
              <span className="truncate">
                {preacher || "All preachers"}
              </span>
              <ChevronDown />
            </ListboxButton>
            <ListboxOptions anchor="bottom start" transition className={`${panelClass} w-64 transition duration-100 ease-out data-closed:opacity-0 data-closed:scale-95`}>
              <ListboxOption value="" className={optionClass}>
                All preachers
                <span className="w-4">{preacher === "" && <Check />}</span>
              </ListboxOption>
              {options.preachers.map((s) => (
                <ListboxOption key={s} value={s} className={optionClass}>
                  {s}
                  <span className="w-4">{preacher === s && <Check />}</span>
                </ListboxOption>
              ))}
            </ListboxOptions>
          </Listbox>

          <Listbox value={series} onChange={onSeriesChange}>
            <ListboxButton className={btnClass}>
              <span className="truncate max-w-48">
                {series || "All series"}
              </span>
              <ChevronDown />
            </ListboxButton>
            <ListboxOptions anchor="bottom start" transition className={`${panelClass} w-72 transition duration-100 ease-out data-closed:opacity-0 data-closed:scale-95`}>
              <ListboxOption value="" className={optionClass}>
                All series
                <span className="w-4">{series === "" && <Check />}</span>
              </ListboxOption>
              {options.series.map((s) => (
                <ListboxOption key={s} value={s} className={optionClass}>
                  {s}
                  <span className="w-4">{series === s && <Check />}</span>
                </ListboxOption>
              ))}
            </ListboxOptions>
          </Listbox>

          <Combobox value={keyword} onChange={(v) => { onKeywordChange(v ?? ""); setKeywordQuery(""); }} onClose={() => setKeywordQuery("")}>
            <div className="relative">
              <ComboboxInput
                className={btnClass + " w-44 pr-8"}
                placeholder="All keywords"
                displayValue={(v: string) => v || ""}
                onChange={(e) => setKeywordQuery(e.target.value)}
              />
              <ComboboxButton className="absolute inset-y-0 right-0 flex items-center pr-2">
                <ChevronDown />
              </ComboboxButton>
            </div>
            <ComboboxOptions anchor="bottom start" transition className={`${panelClass} w-56 transition duration-100 ease-out data-closed:opacity-0 data-closed:scale-95`}>
              <ComboboxOption value="" className={optionClass}>
                All keywords
                <span className="w-4">{keyword === "" && <Check />}</span>
              </ComboboxOption>
              {filteredKeywords.map((kw) => (
                <ComboboxOption key={kw} value={kw} className={optionClass}>
                  {kw}
                  <span className="w-4">{keyword === kw && <Check />}</span>
                </ComboboxOption>
              ))}
              {hasMoreKeywords && (
                <div className="px-3 py-2 text-xs text-gray-500 italic select-none">
                  Type to filter more…
                </div>
              )}
            </ComboboxOptions>
          </Combobox>

          <div className="inline-flex items-center gap-1.5">
            <DatePicker
              value={dateFrom}
              onChange={onDateFromChange}
              min={options.minDate}
              max={dateTo || options.maxDate}
              placeholder="From"
              ariaLabel="Date from"
              initialMonth={options.minDate}
              availableDates={options.availableDates}
            />
            <span className="text-gray-500 text-sm">–</span>
            <DatePicker
              value={dateTo}
              onChange={onDateToChange}
              min={dateFrom || options.minDate}
              max={options.maxDate}
              placeholder="To"
              ariaLabel="Date to"
              initialMonth={options.maxDate}
              availableDates={options.availableDates}
            />
            {(dateFrom || dateTo) && (
              <span
                onClick={() => { onDateFromChange(""); onDateToChange(""); }}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </span>
            )}
          </div>

          <button
            onClick={() => setShowPassagePicker(true)}
            className={btnClass}
          >
            <span className="truncate max-w-48">
              {passage ? passageDisplayLabel(passage) : "Passage"}
            </span>
            {passage ? (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onPassageChange("");
                }}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </span>
            ) : (
              <ChevronDown />
            )}
          </button>

          {pickerBibleIndex && (
            <PassagePicker
              open={showPassagePicker}
              currentPassage={passage}
              bibleIndex={pickerBibleIndex}
              onSelect={onPassageChange}
              onClose={() => setShowPassagePicker(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
