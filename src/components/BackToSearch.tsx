"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect, useMemo } from "react";

const NAV_LIST_KEY = "sermon-nav-list";

const btnBase =
  "w-11 h-11 rounded-full bg-gray-200 dark:bg-gray-800 shadow-lg border border-gray-300 dark:border-gray-700 flex items-center justify-center transition-all";
const btnActive =
  "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:shadow-xl cursor-pointer";
const btnDisabled = "text-gray-300 dark:text-gray-600 cursor-default";

interface NavList {
  ids: string[];
  query: string;
  searchUrl: string;
}

export default function BackToSearch({ sermonId }: { sermonId: string }) {
  const router = useRouter();
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [navList, setNavList] = useState<NavList | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(NAV_LIST_KEY);
      if (raw) setNavList(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const { prevId, nextId } = useMemo(() => {
    if (!navList) return { prevId: null, nextId: null };
    const idx = navList.ids.indexOf(sermonId);
    if (idx === -1) return { prevId: null, nextId: null };
    return {
      prevId: idx > 0 ? navList.ids[idx - 1] : null,
      nextId: idx < navList.ids.length - 1 ? navList.ids[idx + 1] : null,
    };
  }, [navList, sermonId]);

  const makeUrl = (id: string) => {
    const q = navList?.query;
    return q ? `/sermon/${id}?q=${encodeURIComponent(q)}` : `/sermon/${id}`;
  };

  return (
    <>
      {/* Left group: back to search + previous */}
      <div className="fixed bottom-6 left-6 xl:bottom-auto xl:left-auto xl:top-1/2 xl:-translate-y-1/2 xl:right-[calc(50%+27rem)] z-50 flex flex-col gap-3 items-center">
        {/* Back to search — double left chevron */}
        {navList?.searchUrl ? (
          <Link
            href={navList.searchUrl}
            aria-label="Back to search"
            className={`${btnBase} ${btnActive}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="11 18 5 12 11 6" />
              <polyline points="19 18 13 12 19 6" />
            </svg>
          </Link>
        ) : (
          <button
            onClick={() => router.back()}
            aria-label="Back to search"
            className={`${btnBase} ${btnActive}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="11 18 5 12 11 6" />
              <polyline points="19 18 13 12 19 6" />
            </svg>
          </button>
        )}
        {/* Previous sermon — single left chevron */}
        {prevId ? (
          <Link
            href={makeUrl(prevId)}
            aria-label="Previous sermon"
            className={`${btnBase} ${btnActive}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </Link>
        ) : (
          <span
            aria-label="Previous sermon"
            className={`${btnBase} ${btnDisabled}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </span>
        )}
      </div>

      {/* Right group: next + scroll to top */}
      <div className="fixed bottom-6 right-6 xl:bottom-auto xl:right-auto xl:top-1/2 xl:-translate-y-1/2 xl:left-[calc(50%+27rem)] z-50 flex flex-col gap-3 items-center">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label="Scroll to top"
          className={`${btnBase} ${btnActive} transition-opacity ${showScrollTop ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        >
          {/* Double up chevron */}
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="17 11 12 6 7 11" />
            <polyline points="17 18 12 13 7 18" />
          </svg>
        </button>
        {/* Next sermon — single right chevron */}
        {nextId ? (
          <Link
            href={makeUrl(nextId)}
            aria-label="Next sermon"
            className={`${btnBase} ${btnActive}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </Link>
        ) : (
          <span
            aria-label="Next sermon"
            className={`${btnBase} ${btnDisabled}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        )}
      </div>
    </>
  );
}
