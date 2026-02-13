"use client";

import { Suspense, useState, useEffect, useCallback, useRef, useMemo, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import SearchBar from "@/components/SearchBar";
import SermonList from "@/components/SermonList";
import SearchResultList from "@/components/SearchResultList";
import SermonFilters, { SortControl } from "@/components/SermonFilters";
import type { SortBy, FilterOptions } from "@/components/SermonFilters";
import Pagination from "@/components/Pagination";
import { loadSearchIndex, search, searchAny, searchAll, getAllSermons, isLoaded } from "@/lib/search";
import { parseQuery, stripQuotes } from "@/lib/parseQuery";
import { buildBibleIndex, matchesPassageFilter, parsePassageFilter } from "@/lib/bible";
import type { SermonMeta, SermonSnippet, SearchMode } from "@/lib/types";

const SEARCH_MODES: { value: SearchMode; label: string }[] = [
  { value: "any", label: "Any word" },
  { value: "all", label: "All words" },
  { value: "exact", label: "Exact phrase" },
];

const PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 10;
const CACHE_KEY = "sermon-search-state";
const SCROLL_KEY = "sermon-scroll-y";
const NAV_LIST_KEY = "sermon-nav-list";

// Module-level cache for filter options (persists across client-side navigations)
let cachedFilterOptions: FilterOptions | null = null;

const DEFAULT_SEARCH_MODE: SearchMode = "all";

interface CachedState {
  query: string;
  page: number;
  results: SermonMeta[];
  snippets: Record<string, SermonSnippet[]>;
  sortBy?: SortBy;
  pageSize?: number;
  searchMode?: SearchMode;
  filterPreacher?: string;
  filterSeries?: string;
  filterKeyword?: string;
  filterPassage?: string;
  filterDateFrom?: string;
  filterDateTo?: string;
}

function readCache(query: string, page: number): CachedState | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached: CachedState = JSON.parse(raw);
    if (cached.query === query && cached.page === page) {
      // For search mode, require results; for browse mode, filters alone are enough
      if (cached.query || cached.sortBy || cached.filterPreacher || cached.filterSeries || cached.filterPassage) {
        return cached;
      }
    }
  } catch {}
  return null;
}

function HomeContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const initialPage = Number(searchParams.get("page")) || 1;
  const initialSort = (searchParams.get("sort") as SortBy) || (initialQuery.trim() ? "best-match" : "date-desc");
  const initialPreacher = searchParams.get("preacher") || "";
  const initialSeries = searchParams.get("series") || "";
  const initialKeyword = searchParams.get("keyword") || "";
  const initialPassage = searchParams.get("passage") || "";
  const initialDateFrom = searchParams.get("dateFrom") || "";
  const initialDateTo = searchParams.get("dateTo") || "";
  const initialPageSize = Number(searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE;
  const initialMode = (searchParams.get("mode") as SearchMode) || DEFAULT_SEARCH_MODE;

  // Try to restore from sessionStorage on mount
  const cached = useRef(readCache(initialQuery, initialPage));

  // If the search index is still in memory from a previous mount, skip loading entirely
  const alreadyLoaded = isLoaded() && cachedFilterOptions !== null;

  const [query, setQuery] = useState(cached.current?.query ?? initialQuery);
  const [inputValue, setInputValue] = useState(query);
  const [, startTransition] = useTransition();
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [results, setResults] = useState<SermonMeta[]>(() => {
    if (cached.current?.results?.length) return cached.current.results;
    if (alreadyLoaded) {
      if (!initialQuery.trim()) return getAllSermons();
      const stripped = stripQuotes(initialQuery);
      return initialMode === "all" ? searchAll(stripped) : initialMode === "any" ? searchAny(stripped) : search(stripped);
    }
    return [];
  });
  const [loading, setLoading] = useState(
    !alreadyLoaded && !(cached.current && cached.current.results.length > 0)
  );
  const [snippets, setSnippets] = useState<Record<string, SermonSnippet[]>>(
    cached.current?.snippets ?? {}
  );
  const [snippetsLoading, setSnippetsLoading] = useState(false);
  const [page, setPage] = useState(cached.current?.page ?? initialPage);
  const [sortBy, setSortBy] = useState<SortBy>(cached.current?.sortBy ?? initialSort);
  const [filterPreacher, setFilterPreacher] = useState(cached.current?.filterPreacher ?? initialPreacher);
  const [filterSeries, setFilterSeries] = useState(cached.current?.filterSeries ?? initialSeries);
  const [filterKeyword, setFilterKeyword] = useState(cached.current?.filterKeyword ?? initialKeyword);
  const [filterPassage, setFilterPassage] = useState(cached.current?.filterPassage ?? initialPassage);
  const [filterDateFrom, setFilterDateFrom] = useState(cached.current?.filterDateFrom ?? initialDateFrom);
  const [filterDateTo, setFilterDateTo] = useState(cached.current?.filterDateTo ?? initialDateTo);
  const [pageSize, setPageSize] = useState(cached.current?.pageSize ?? initialPageSize);
  const [searchMode, setSearchMode] = useState<SearchMode>(cached.current?.searchMode ?? initialMode);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(cachedFilterOptions);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipSnippetFetch = useRef(!!cached.current?.query);
  const savedScrollY = useRef<number | null>(null);
  if (savedScrollY.current === null) {
    try {
      const v = sessionStorage.getItem(SCROLL_KEY);
      if (v) savedScrollY.current = parseInt(v, 10);
    } catch {}
  }

  const isSearching = query.trim() !== "";

  // Sync query, page, and filters to URL (replaceState avoids history entries per keystroke)
  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (page > 1) params.set("page", String(page));
    if (sortBy !== "date-desc") params.set("sort", sortBy);
    if (filterPreacher) params.set("preacher", filterPreacher);
    if (filterSeries) params.set("series", filterSeries);
    if (filterKeyword) params.set("keyword", filterKeyword);
    if (filterPassage) params.set("passage", filterPassage);
    if (filterDateFrom) params.set("dateFrom", filterDateFrom);
    if (filterDateTo) params.set("dateTo", filterDateTo);
    if (pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(pageSize));
    if (searchMode !== DEFAULT_SEARCH_MODE) params.set("mode", searchMode);
    const qs = params.toString();
    const url = qs ? `?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [query, page, sortBy, filterPreacher, filterSeries, filterKeyword, filterPassage, filterDateFrom, filterDateTo, pageSize, searchMode]);

  // Persist state to sessionStorage for back-navigation restore
  useEffect(() => {
    if (isSearching && results.length > 0 && !snippetsLoading) {
      // Only cache snippets that have content (phrase queries store empty arrays for non-matches
      // which are needed for filtering but not worth persisting)
      const cachedSnippets: Record<string, SermonSnippet[]> = {};
      for (const [id, s] of Object.entries(snippets)) {
        if (s.length > 0) cachedSnippets[id] = s;
      }
      try {
        sessionStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ query, page, results, snippets: cachedSnippets, sortBy, pageSize, searchMode, filterPreacher, filterSeries, filterKeyword, filterPassage, filterDateFrom, filterDateTo })
        );
      } catch {}
    } else if (!isSearching) {
      // In browse mode, still cache filter/sort/page state (results reload fast from index)
      try {
        sessionStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ query: "", page, results: [], snippets: {}, sortBy, pageSize, searchMode, filterPreacher, filterSeries, filterKeyword, filterPassage, filterDateFrom, filterDateTo })
        );
      } catch {}
    }
  }, [query, page, results, snippets, snippetsLoading, isSearching, sortBy, pageSize, searchMode, filterPreacher, filterSeries, filterKeyword, filterPassage, filterDateFrom, filterDateTo]);

  // Save scroll position continuously (throttled via rAF)
  useEffect(() => {
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(() => {
          try { sessionStorage.setItem(SCROLL_KEY, String(window.scrollY)); } catch {}
          ticking = false;
        });
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Restore scroll position after content loads
  useEffect(() => {
    if (!loading && savedScrollY.current !== null) {
      const y = savedScrollY.current;
      savedScrollY.current = null;
      requestAnimationFrame(() => {
        window.scrollTo(0, y);
      });
    }
  }, [loading]);

  // Load index and filter options (skip if already in memory)
  useEffect(() => {
    if (alreadyLoaded) return;

    Promise.all([
      loadSearchIndex(),
      cachedFilterOptions
        ? Promise.resolve(cachedFilterOptions)
        : fetch("/filters.json").then((r) => r.json()),
    ])
      .then(([, filters]) => {
        cachedFilterOptions = filters;
        setFilterOptions(filters);
        setLoading(false);
        // Only set results if we didn't restore from cache
        if (!cached.current) {
          if (initialQuery.trim()) {
            const stripped = stripQuotes(initialQuery);
            setResults(initialMode === "all" ? searchAll(stripped) : initialMode === "any" ? searchAny(stripped) : search(stripped));
          } else {
            setResults(getAllSermons());
          }
        } else if (!cached.current.query) {
          // Cached but was browsing (no query) — load all sermons
          setResults(getAllSermons());
        }
      })
      .catch((err) => {
        console.error("Failed to load search index:", err);
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Compute effective phrases/terms based on search mode.
  // "exact" treats the entire query as one phrase; "all"/"any" respect manual quotes.
  const effectiveParsed = useMemo(() => {
    if (searchMode === "exact" && query.trim()) {
      return { phrases: [stripQuotes(query.trim()).toLowerCase()], terms: [] };
    }
    return parseQuery(query);
  }, [query, searchMode]);

  const hasPhrases = effectiveParsed.phrases.length > 0;

  // For phrase queries, send ALL result IDs so the API can filter by transcript content.
  // For non-phrase queries, we only need snippets for display, not filtering.
  const phraseSnippetIds = useMemo(() => {
    if (!hasPhrases) return [];
    return results.map((s) => s.id);
  }, [results, hasPhrases]);

  // Build the query string sent to the snippets API.
  // For "exact" mode, wrap in quotes so the API treats the full query as a phrase.
  const snippetApiQuery = useMemo(() => {
    if (searchMode === "exact" && query.trim()) {
      return `"${stripQuotes(query.trim())}"`;
    }
    return query.trim();
  }, [query, searchMode]);

  // Phrase-query snippet fetch (all IDs — needed for baseFiltered phrase filtering)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Skip the first fetch if we restored snippets from cache
    if (skipSnippetFetch.current) {
      skipSnippetFetch.current = false;
      return;
    }

    if (!query.trim()) {
      setSnippets({});
      setSnippetsLoading(false);
      return;
    }

    // Non-phrase queries handle snippets separately (page-level fetch below)
    if (!hasPhrases) return;

    if (phraseSnippetIds.length === 0) {
      setSnippets({});
      setSnippetsLoading(false);
      return;
    }

    setSnippetsLoading(true);

    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/snippets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: phraseSnippetIds,
            query: snippetApiQuery,
          }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Snippet fetch failed");
        const data = await res.json();
        setSnippets(data);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Snippet fetch error:", err);
      } finally {
        if (abortRef.current === controller) {
          setSnippetsLoading(false);
        }
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, phraseSnippetIds, hasPhrases, snippetApiQuery]);

  const searchModeRef = useRef(searchMode);
  searchModeRef.current = searchMode;

  const runSearch = useCallback((q: string, mode: SearchMode) => {
    setQuery(q);
    setPage(1);
    if (q.trim() !== "") {
      setSortBy((prev) => (prev === "date-desc" ? "best-match" : prev));
    } else {
      setSortBy((prev) => (prev === "best-match" ? "date-desc" : prev));
    }
    if (!isLoaded()) return;
    if (q.trim() === "") {
      setResults(getAllSermons());
    } else {
      const stripped = stripQuotes(q);
      setResults(mode === "any" ? searchAny(stripped) : searchAll(stripped));
    }
  }, []);

  const handleSearch = useCallback((q: string) => {
    // Update input immediately so typing is never laggy
    setInputValue(q);

    // Debounce the expensive search/state updates
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      startTransition(() => {
        runSearch(q, searchModeRef.current);
      });
    }, 150);
  }, [runSearch]);

  const handleModeChange = useCallback((mode: SearchMode) => {
    setSearchMode(mode);
    startTransition(() => {
      runSearch(inputValue, mode);
    });
  }, [runSearch, inputValue]);

  const handleSortChange = useCallback((v: SortBy) => {
    setSortBy(v);
    setPage(1);
  }, []);

  const handlePreacherChange = useCallback((v: string) => {
    setFilterPreacher(v);
    setPage(1);
  }, []);

  const handleSeriesChange = useCallback((v: string) => {
    setFilterSeries(v);
    setPage(1);
  }, []);

  const handleKeywordChange = useCallback((v: string) => {
    setFilterKeyword(v);
    setPage(1);
  }, []);

  const handlePassageChange = useCallback((v: string) => {
    setFilterPassage(v);
    setPage(1);
  }, []);

  const handleDateFromChange = useCallback((v: string) => {
    setFilterDateFrom(v);
    setPage(1);
  }, []);

  const handleDateToChange = useCallback((v: string) => {
    setFilterDateTo(v);
    setPage(1);
  }, []);

  const handlePageSizeChange = useCallback((v: number) => {
    setPageSize(v);
    setPage(1);
  }, []);

  const bibleIndex = useMemo(() => {
    if (loading) return null;
    return buildBibleIndex(getAllSermons());
  }, [loading]);

  // Compute the base set of results (before metadata filters) for dynamic option computation.
  // When snippets are loading for a phrase query, preserve the previous filtered results
  // to avoid flashing a broader unfiltered candidate set.
  const lastPhraseFiltered = useRef<SermonMeta[]>([]);
  const baseFiltered = useMemo(() => {
    if (isSearching) {
      if (effectiveParsed.phrases.length === 0) {
        return results;
      }
      if (snippetsLoading) {
        return lastPhraseFiltered.current;
      }
      // Keep results that have the phrase in the transcript OR in metadata fields
      // (e.g. searching for "Ian Hamilton" should still show sermons preached by him)
      const filtered = results.filter((s) => {
        if (snippets[s.id] && snippets[s.id].length > 0) return true;
        // Check if any phrase matches a metadata field
        const meta = [s.title, s.preacher, s.bibleText, s.keywords, s.moreInfoText]
          .filter(Boolean)
          .map((v) => v!.toLowerCase());
        return effectiveParsed.phrases.some((phrase) =>
          meta.some((field) => field.includes(phrase))
        );
      });
      lastPhraseFiltered.current = filtered;
      return filtered;
    }
    return results;
  }, [isSearching, results, snippets, snippetsLoading, effectiveParsed]);

  // Bible index filtered by other active filters (for passage picker cascading)
  const pickerBibleIndex = useMemo(() => {
    if (loading) return null;
    let pool = baseFiltered;
    if (filterPreacher) pool = pool.filter((s) => s.preacher === filterPreacher);
    if (filterSeries) pool = pool.filter((s) => s.series === filterSeries);
    if (filterKeyword) pool = pool.filter((s) =>
      s.keywords != null && s.keywords.split(/\s+/).some((kw) => kw.toLowerCase() === filterKeyword.toLowerCase())
    );
    if (filterDateFrom) pool = pool.filter((s) => s.preachDate != null && s.preachDate >= filterDateFrom);
    if (filterDateTo) pool = pool.filter((s) => s.preachDate != null && s.preachDate <= filterDateTo);
    return buildBibleIndex(pool);
  }, [loading, baseFiltered, filterPreacher, filterSeries, filterKeyword, filterDateFrom, filterDateTo]);

  // Dynamic filter options: each dropdown only shows values compatible with the OTHER active filters
  const dynamicFilterOptions = useMemo<FilterOptions | null>(() => {
    if (!filterOptions) return null;

    // For each filter, compute the pool of sermons matching all OTHER filters
    const matchesSeries = (s: SermonMeta) => !filterSeries || s.series === filterSeries;
    const matchesKeyword = (s: SermonMeta) =>
      !filterKeyword || (s.keywords != null && s.keywords.split(/\s+/).some((kw) => kw.toLowerCase() === filterKeyword.toLowerCase()));
    const matchesPreacher = (s: SermonMeta) => !filterPreacher || s.preacher === filterPreacher;
    const matchesPassage = (s: SermonMeta) => {
      if (!filterPassage || !bibleIndex) return true;
      const parsed = parsePassageFilter(filterPassage);
      const refs = bibleIndex.sermonRefs.get(s.id);
      if (!refs) return false;
      return matchesPassageFilter(refs, parsed.book, parsed.chapter, parsed.verse);
    };
    const matchesDate = (s: SermonMeta) => {
      if (!filterDateFrom && !filterDateTo) return true;
      if (!s.preachDate) return false;
      if (filterDateFrom && s.preachDate < filterDateFrom) return false;
      if (filterDateTo && s.preachDate > filterDateTo) return false;
      return true;
    };

    const forPreachers = baseFiltered.filter((s) => matchesSeries(s) && matchesKeyword(s) && matchesPassage(s) && matchesDate(s));
    const forSeries = baseFiltered.filter((s) => matchesPreacher(s) && matchesKeyword(s) && matchesPassage(s) && matchesDate(s));
    const forKeywords = baseFiltered.filter((s) => matchesPreacher(s) && matchesSeries(s) && matchesPassage(s) && matchesDate(s));

    const preachers = [...new Set(forPreachers.map((s) => s.preacher))].sort();
    const series = [...new Set(forSeries.map((s) => s.series).filter(Boolean))].sort() as string[];
    const keywords = [
      ...new Set(
        forKeywords
          .map((s) => s.keywords)
          .filter(Boolean)
          .flatMap((kw) => (kw as string).split(/\s+/))
          .map((kw) => kw.trim())
          .filter((kw) => kw.length > 0)
      ),
    ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    // Compute available date range from sermons matching all non-date filters
    const forDates = baseFiltered.filter((s) => matchesPreacher(s) && matchesSeries(s) && matchesKeyword(s) && matchesPassage(s));
    const dates = forDates.map((s) => s.preachDate).filter(Boolean) as string[];
    const minDate = dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : undefined;
    const maxDate = dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : undefined;

    return { preachers, series, keywords, minDate, maxDate };
  }, [filterOptions, baseFiltered, filterPreacher, filterSeries, filterKeyword, filterPassage, filterDateFrom, filterDateTo, bibleIndex]);

  // Apply filters/sort for browse mode, phrase filtering + filters for search mode
  const displayResults = useMemo(() => {
    let filtered = baseFiltered;

    if (filterPreacher) {
      filtered = filtered.filter((s) => s.preacher === filterPreacher);
    }
    if (filterSeries) {
      filtered = filtered.filter((s) => s.series === filterSeries);
    }
    if (filterKeyword) {
      filtered = filtered.filter((s) =>
        s.keywords != null && s.keywords.split(/\s+/).some((kw) => kw.toLowerCase() === filterKeyword.toLowerCase())
      );
    }
    if (filterPassage && bibleIndex) {
      const parsed = parsePassageFilter(filterPassage);
      filtered = filtered.filter((s) => {
        const refs = bibleIndex.sermonRefs.get(s.id);
        if (!refs) return false;
        return matchesPassageFilter(refs, parsed.book, parsed.chapter, parsed.verse);
      });
    }
    if (filterDateFrom) {
      filtered = filtered.filter((s) => s.preachDate != null && s.preachDate >= filterDateFrom);
    }
    if (filterDateTo) {
      filtered = filtered.filter((s) => s.preachDate != null && s.preachDate <= filterDateTo);
    }

    const eventOrder = (e: string | null) => (e === "Sunday - PM" ? 1 : 0);
    const sorted = [...filtered];
    switch (sortBy) {
      case "best-match":
        // Preserve search-engine relevance order
        break;
      case "date-desc":
        sorted.sort((a, b) => {
          if (!a.preachDate && !b.preachDate) return 0;
          if (!a.preachDate) return 1;
          if (!b.preachDate) return -1;
          const diff = new Date(b.preachDate).getTime() - new Date(a.preachDate).getTime();
          if (diff !== 0) return diff;
          return eventOrder(b.eventType) - eventOrder(a.eventType);
        });
        break;
      case "date-asc":
        sorted.sort((a, b) => {
          if (!a.preachDate && !b.preachDate) return 0;
          if (!a.preachDate) return 1;
          if (!b.preachDate) return -1;
          const diff = new Date(a.preachDate).getTime() - new Date(b.preachDate).getTime();
          if (diff !== 0) return diff;
          return eventOrder(a.eventType) - eventOrder(b.eventType);
        });
        break;
      case "preacher-asc":
        sorted.sort((a, b) => a.preacher.localeCompare(b.preacher));
        break;
      case "title-asc":
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      // date-desc is the default order from getAllSermons()
    }

    return sorted;
  }, [baseFiltered, filterPreacher, filterSeries, filterKeyword, filterPassage, filterDateFrom, filterDateTo, bibleIndex, sortBy]);

  // Save nav list for sermon detail page prev/next navigation
  useEffect(() => {
    if (displayResults.length === 0) return;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (page > 1) params.set("page", String(page));
    const navDefaultSort = query.trim() ? "best-match" : "date-desc";
    if (sortBy !== navDefaultSort) params.set("sort", sortBy);
    if (filterPreacher) params.set("preacher", filterPreacher);
    if (filterSeries) params.set("series", filterSeries);
    if (filterKeyword) params.set("keyword", filterKeyword);
    if (filterPassage) params.set("passage", filterPassage);
    if (filterDateFrom) params.set("dateFrom", filterDateFrom);
    if (filterDateTo) params.set("dateTo", filterDateTo);
    if (pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(pageSize));
    if (searchMode !== DEFAULT_SEARCH_MODE) params.set("mode", searchMode);
    const qs = params.toString();
    try {
      sessionStorage.setItem(
        NAV_LIST_KEY,
        JSON.stringify({
          ids: displayResults.map((s) => s.id),
          query: query.trim(),
          searchUrl: qs ? `/?${qs}` : "/",
        })
      );
    } catch {}
  }, [displayResults, query, page, sortBy, pageSize, searchMode, filterPreacher, filterSeries, filterKeyword, filterPassage, filterDateFrom, filterDateTo]);

  const pageSizeControl = (
    <span className="hidden sm:inline text-sm text-gray-500 dark:text-gray-400">
      Show{" "}
      {PAGE_SIZES.map((size, i) => (
        <span key={size}>
          {i > 0 && <span className="mx-1">/</span>}
          <button
            onClick={() => handlePageSizeChange(size)}
            className={`cursor-pointer ${size === pageSize ? "font-semibold text-gray-900 dark:text-gray-100" : "hover:text-gray-700 dark:hover:text-gray-300"}`}
          >
            {size}
          </button>
        </span>
      ))}
    </span>
  );

  const modePills = (
    <div className="flex gap-1">
      {SEARCH_MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          onClick={() => handleModeChange(m.value)}
          className={`px-3 py-1 text-xs rounded-full cursor-pointer transition-colors ${
            searchMode === m.value
              ? "bg-gray-300 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
              : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );

  const totalPages = Math.ceil(displayResults.length / pageSize);
  const paginatedResults = displayResults.slice(
    (page - 1) * pageSize,
    page * pageSize
  );

  // IDs of the sermons currently visible on the page — derived from stable
  // memoized inputs so the reference only changes when content actually changes.
  const pageIds = useMemo(() => {
    const start = (page - 1) * pageSize;
    return displayResults.slice(start, start + pageSize).map((s) => s.id);
  }, [displayResults, page, pageSize]);

  // Page-level snippet fetch for non-phrase queries.
  // For phrase queries, snippets are already fetched above for all results.
  const pageAbortRef = useRef<AbortController | null>(null);
  const pageDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snippetsRef = useRef(snippets);
  snippetsRef.current = snippets;
  const snippetQueryRef = useRef(query);
  useEffect(() => {
    if (pageDebounceRef.current) clearTimeout(pageDebounceRef.current);

    if (!query.trim() || hasPhrases || pageIds.length === 0) return;

    // When query changes, all page IDs need fresh snippets regardless of cache
    const queryChanged = query !== snippetQueryRef.current;
    const missing = queryChanged
      ? [...pageIds]
      : pageIds.filter((id) => !(id in snippetsRef.current));
    if (missing.length === 0) return;

    setSnippetsLoading(true);

    pageDebounceRef.current = setTimeout(async () => {
      if (pageAbortRef.current) pageAbortRef.current.abort();
      const controller = new AbortController();
      pageAbortRef.current = controller;

      try {
        const res = await fetch("/api/snippets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: missing, query: query.trim() }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Snippet fetch failed");
        const data: Record<string, SermonSnippet[]> = await res.json();
        snippetQueryRef.current = query;
        // Replace when query changed (stale data); merge when paginating same query
        if (queryChanged) {
          setSnippets(data);
        } else {
          setSnippets((prev) => ({ ...prev, ...data }));
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("Snippet fetch error:", err);
      } finally {
        if (pageAbortRef.current === controller) {
          setSnippetsLoading(false);
        }
      }
    }, 100);

    return () => {
      if (pageDebounceRef.current) clearTimeout(pageDebounceRef.current);
    };
  }, [query, hasPhrases, pageIds]);

  return (
      <div className="flex-1 max-w-3xl w-full min-h-dvh bg-gray-50 dark:bg-gray-950 mx-auto px-4 py-12">
        <header className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {process.env.NEXT_PUBLIC_SITE_TITLE || "Sermon Transcripts"}
          </h1>
          <p className="text-gray-500 dark:text-gray-400">
            Search through sermon transcripts by keyword, preacher, passage, or
            topic.
          </p>
        </header>

        <div className="mb-4">
          <SearchBar value={inputValue} onChange={handleSearch} loading={loading} />
        </div>

        {loading ? null : isSearching ? (
          <>
            {dynamicFilterOptions && (
              <SermonFilters
                options={dynamicFilterOptions}
                sortBy={sortBy}
                preacher={filterPreacher}
                series={filterSeries}
                keyword={filterKeyword}
                passage={filterPassage}
                dateFrom={filterDateFrom}
                dateTo={filterDateTo}
                bibleIndex={bibleIndex}
                pickerBibleIndex={pickerBibleIndex}
                onSortChange={handleSortChange}
                onPreacherChange={handlePreacherChange}
                onSeriesChange={handleSeriesChange}
                onKeywordChange={handleKeywordChange}
                onPassageChange={handlePassageChange}
                onDateFromChange={handleDateFromChange}
                onDateToChange={handleDateToChange}
                isSearching
                toolbar={modePills}
              />
            )}
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
            <SearchResultList
              sermons={paginatedResults}
              totalCount={displayResults.length}
              snippets={snippets}
              snippetsLoading={snippetsLoading}
              query={query}
              searchMode={searchMode}
              sortControl={<SortControl sortBy={sortBy} onSortChange={handleSortChange} isSearching />}
              pageSizeControl={pageSizeControl}
            />
          </>
        ) : (
          <>
            {dynamicFilterOptions && (
              <SermonFilters
                options={dynamicFilterOptions}
                sortBy={sortBy}
                preacher={filterPreacher}
                series={filterSeries}
                keyword={filterKeyword}
                passage={filterPassage}
                dateFrom={filterDateFrom}
                dateTo={filterDateTo}
                bibleIndex={bibleIndex}
                pickerBibleIndex={pickerBibleIndex}
                onSortChange={handleSortChange}
                onPreacherChange={handlePreacherChange}
                onSeriesChange={handleSeriesChange}
                onKeywordChange={handleKeywordChange}
                onPassageChange={handlePassageChange}
                onDateFromChange={handleDateFromChange}
                onDateToChange={handleDateToChange}
                toolbar={modePills}
              />
            )}
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
            <SermonList
              sermons={paginatedResults}
              totalCount={displayResults.length}
              sortControl={<SortControl sortBy={sortBy} onSortChange={handleSortChange} />}
              pageSizeControl={pageSizeControl}
            />
          </>
        )}

        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      </div>
  );
}

export default function Home() {
  return (
    <Suspense
      fallback={<main className="min-h-screen bg-gray-50 dark:bg-gray-950" />}
    >
      <HomeContent />
    </Suspense>
  );
}
