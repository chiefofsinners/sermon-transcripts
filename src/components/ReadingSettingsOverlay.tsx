"use client";

import { useReadingSettings } from "./ReadingSettingsProvider";

type FontSize = "small" | "medium" | "large" | "xlarge";
type FontFamily = "sans" | "serif";

export default function ReadingSettingsOverlay({ onClose }: { onClose: () => void }) {
  const { fontSize, fontFamily, setFontSize, setFontFamily } = useReadingSettings();

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-100 dark:bg-gray-900 rounded-2xl p-6 w-full max-w-sm sm:max-w-md mx-4 shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Reading Settings
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

        {/* Font Size */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
            Font Size
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(["small", "medium", "large", "xlarge"] as FontSize[]).map((size) => (
              <button
                key={size}
                onClick={() => setFontSize(size)}
                className={`py-2.5 px-3 rounded-lg text-base font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  fontSize === size
                    ? "bg-gray-500 text-white dark:bg-gray-100 dark:text-gray-900"
                    : "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700"
                }`}
              >
                {size === "xlarge" ? "X-Large" : size.charAt(0).toUpperCase() + size.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Font Style */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
            Font Style
          </label>
          <div className="flex gap-2">
            {(
              [
                { key: "sans", label: "Sans-serif", font: "ui-sans-serif, system-ui, sans-serif" },
                { key: "serif", label: "Serif", font: 'Georgia, Cambria, "Times New Roman", serif' },
              ] as { key: FontFamily; label: string; font: string }[]
            ).map(({ key, label, font }) => (
              <button
                key={key}
                onClick={() => setFontFamily(key)}
                style={{ fontFamily: font }}
                className={`flex-1 py-2.5 px-3 rounded-lg text-base font-medium transition-colors cursor-pointer ${
                  fontFamily === key
                    ? "bg-gray-500 text-white dark:bg-gray-100 dark:text-gray-900"
                    : "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="[@media(max-height:600px)]:hidden rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
            Preview
          </label>
          <p
            style={{
              fontSize: { small: "0.9rem", medium: "1rem", large: "1.2rem", xlarge: "1.4rem" }[fontSize],
              fontFamily: fontFamily === "serif"
                ? 'Georgia, Cambria, "Times New Roman", Times, serif'
                : "ui-sans-serif, system-ui, sans-serif",
              lineHeight: 1.6,
            }}
            className="text-gray-800 dark:text-gray-200"
          >
            For by grace you have been saved through faith, and that not of yourselves; it is the gift of God.
          </p>
        </div>
      </div>
    </div>
  );
}
