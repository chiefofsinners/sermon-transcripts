"use client";

import { useState, useMemo, useCallback } from "react";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function parseDate(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function sameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface CalendarDay {
  date: Date;
  inMonth: boolean;
  disabled: boolean;
}

function getCalendarDays(year: number, month: number, minDate: Date | null, maxDate: Date | null): CalendarDay[] {
  const first = new Date(year, month, 1);
  // Monday=0 based start of week
  let startDay = first.getDay() - 1;
  if (startDay < 0) startDay = 6;

  const days: CalendarDay[] = [];

  // Fill in leading days from previous month
  for (let i = startDay - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    days.push({ date: d, inMonth: false, disabled: isDisabled(d, minDate, maxDate) });
  }

  // Days in current month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  for (let i = 1; i <= daysInMonth; i++) {
    const d = new Date(year, month, i);
    days.push({ date: d, inMonth: true, disabled: isDisabled(d, minDate, maxDate) });
  }

  // Fill trailing days
  const remaining = 42 - days.length; // 6 rows
  for (let i = 1; i <= remaining; i++) {
    const d = new Date(year, month + 1, i);
    days.push({ date: d, inMonth: false, disabled: isDisabled(d, minDate, maxDate) });
  }

  return days;
}

function isDisabled(d: Date, minDate: Date | null, maxDate: Date | null): boolean {
  if (minDate && d < new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate())) return true;
  if (maxDate && d > new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate())) return true;
  return false;
}

function formatDisplay(value: string, placeholder: string, short?: boolean): string {
  if (!value) return placeholder;
  const d = parseDate(value);
  if (!d) return value;
  if (short) {
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = String(d.getFullYear()).slice(-2);
    return `${day}/${month}/${year}`;
  }
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

const defaultBtnClass =
  "inline-flex items-center gap-2 px-3.5 py-2 text-base sm:px-3 sm:py-1.5 sm:text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-gray-200 dark:bg-gray-950 text-gray-700 dark:text-gray-300 shadow-sm hover:bg-gray-300 dark:hover:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500 focus:border-transparent cursor-pointer";

export default function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = "Pick date",
  ariaLabel,
  className,
  shortDisplay,
  initialMonth,
  availableDates,
}: {
  value: string;
  onChange: (v: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  shortDisplay?: boolean;
  /** Date string (YYYY-MM-DD) whose month to show when picker opens with no selected value */
  initialMonth?: string;
  /** Set of date strings (YYYY-MM-DD) that have entries — only these dates are highlighted */
  availableDates?: Set<string>;
}) {
  const selected = useMemo(() => parseDate(value), [value]);
  const minDate = useMemo(() => parseDate(min ?? ""), [min]);
  const maxDate = useMemo(() => parseDate(max ?? ""), [max]);

  const initDate = selected ?? new Date();
  const [viewYear, setViewYear] = useState(initDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initDate.getMonth());

  const days = useMemo(
    () => getCalendarDays(viewYear, viewMonth, minDate, maxDate),
    [viewYear, viewMonth, minDate, maxDate]
  );

  const prevMonth = useCallback(() => {
    if (viewMonth === 0) {
      setViewYear(viewYear - 1);
      setViewMonth(11);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }, [viewYear, viewMonth]);

  const nextMonth = useCallback(() => {
    if (viewMonth === 11) {
      setViewYear(viewYear + 1);
      setViewMonth(0);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }, [viewYear, viewMonth]);

  const prevYear = useCallback(() => {
    const newY = viewYear - 1;
    setViewYear(newY);
    // Clamp month if landing on minDate's year
    if (minDate && newY === minDate.getFullYear() && viewMonth < minDate.getMonth()) {
      setViewMonth(minDate.getMonth());
    }
  }, [viewYear, viewMonth, minDate]);

  const nextYear = useCallback(() => {
    const newY = viewYear + 1;
    setViewYear(newY);
    // Clamp month if landing on maxDate's year
    if (maxDate && newY === maxDate.getFullYear() && viewMonth > maxDate.getMonth()) {
      setViewMonth(maxDate.getMonth());
    }
  }, [viewYear, viewMonth, maxDate]);

  const today = useMemo(() => new Date(), []);

  // Determine which nav buttons should be disabled (compare year+month as a single value)
  const viewYM = viewYear * 12 + viewMonth;
  const minYM = minDate ? minDate.getFullYear() * 12 + minDate.getMonth() : -Infinity;
  const maxYM = maxDate ? maxDate.getFullYear() * 12 + maxDate.getMonth() : Infinity;
  const canPrevMonth = viewYM > minYM;
  const canNextMonth = viewYM < maxYM;
  const canPrevYear = viewYM - 12 >= minYM;
  const canNextYear = viewYM + 12 <= maxYM;

  const navBtnClass = (enabled: boolean) =>
    `p-1 rounded ${enabled ? "hover:bg-gray-300 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 cursor-pointer" : "text-gray-400 dark:text-gray-700 cursor-not-allowed"}`;

  return (
    <Popover className="relative">
      {({ close }) => (
        <>
          <PopoverButton
            className={className ?? defaultBtnClass}
            aria-label={ariaLabel}
            onClick={() => {
              // Reset view to selected date, or initialMonth, when opening
              const d = selected ?? parseDate(initialMonth ?? "") ?? new Date();
              setViewYear(d.getFullYear());
              setViewMonth(d.getMonth());
            }}
          >
            <svg className="w-4 h-4 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
            </svg>
            {shortDisplay ? (
              <>
                <span className="truncate">{formatDisplay(value, placeholder, true)}</span>
              </>
            ) : (
              <span className="truncate">{formatDisplay(value, placeholder)}</span>
            )}
          </PopoverButton>

          <PopoverPanel
            anchor="bottom start"
            transition
            className="z-20 mt-1 rounded-lg bg-gray-200 dark:bg-gray-950 shadow-lg ring-1 ring-black/5 dark:ring-white/10 p-3 w-70 transition duration-100 ease-out data-closed:opacity-0 data-closed:scale-95 [--anchor-gap:4px] [--anchor-padding:16px]"
          >
            {/* Header: year + month nav */}
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={prevYear}
                disabled={!canPrevYear}
                className={navBtnClass(canPrevYear)}
                aria-label="Previous year"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={prevMonth}
                disabled={!canPrevMonth}
                className={navBtnClass(canPrevMonth)}
                aria-label="Previous month"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
              </button>

              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 select-none">
                {MONTH_NAMES[viewMonth]} {viewYear}
              </span>

              <button
                type="button"
                onClick={nextMonth}
                disabled={!canNextMonth}
                className={navBtnClass(canNextMonth)}
                aria-label="Next month"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={nextYear}
                disabled={!canNextYear}
                className={navBtnClass(canNextYear)}
                aria-label="Next year"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 4.5l7.5 7.5-7.5 7.5m6-15l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            </div>

            {/* Day-of-week headers */}
            <div className="grid grid-cols-7 mb-1">
              {DAY_LABELS.map((d) => (
                <div key={d} className="text-center text-xs font-medium text-gray-500 py-1 select-none">
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7">
              {days.map((day, i) => {
                const isSelected = sameDay(day.date, selected);
                const isToday = sameDay(day.date, today);
                const hasEntry = !availableDates || availableDates.has(fmt(day.date));
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={day.disabled}
                    onClick={() => {
                      onChange(fmt(day.date));
                      close();
                    }}
                    className={[
                      "w-full aspect-square flex items-center justify-center text-sm rounded-md cursor-pointer transition-colors",
                      day.disabled
                        ? "text-gray-300 dark:text-gray-700 cursor-not-allowed"
                        : hasEntry
                          ? day.inMonth
                            ? "text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-300 dark:hover:bg-gray-800"
                            : "text-gray-500 dark:text-gray-500 font-semibold hover:bg-gray-300 dark:hover:bg-gray-800"
                          : day.inMonth
                            ? "text-gray-400 dark:text-gray-600 hover:bg-gray-300 dark:hover:bg-gray-800"
                            : "text-gray-300 dark:text-gray-700 hover:bg-gray-300 dark:hover:bg-gray-800",
                      isSelected && "bg-gray-700! dark:bg-gray-300! text-white! dark:text-gray-900! font-semibold",
                      isToday && !isSelected && "ring-1 ring-gray-400 dark:ring-gray-500",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {day.date.getDate()}
                  </button>
                );
              })}
            </div>

            {/* Footer: today + clear */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-300 dark:border-gray-700">
              <button
                type="button"
                onClick={() => {
                  setViewYear(today.getFullYear());
                  setViewMonth(today.getMonth());
                }}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer"
              >
                Today
              </button>
              {value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    close();
                  }}
                  className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>
          </PopoverPanel>
        </>
      )}
    </Popover>
  );
}
