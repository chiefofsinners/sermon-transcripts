"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

type FontSize = "small" | "medium" | "large" | "xlarge";
type FontFamily = "sans" | "serif";

interface ReadingSettings {
  fontSize: FontSize;
  fontFamily: FontFamily;
  setFontSize: (size: FontSize) => void;
  setFontFamily: (family: FontFamily) => void;
}

const ReadingSettingsContext = createContext<ReadingSettings>({
  fontSize: "medium",
  fontFamily: "sans",
  setFontSize: () => {},
  setFontFamily: () => {},
});

export function useReadingSettings() {
  return useContext(ReadingSettingsContext);
}

const STORAGE_KEY = "reading-settings";

const fontSizeMap: Record<FontSize, string> = {
  small: "0.9rem",
  medium: "1rem",
  large: "1.2rem",
  xlarge: "1.4rem",
};

const fontFamilyMap: Record<FontFamily, string> = {
  sans: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
  serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
};

export default function ReadingSettingsProvider({ children }: { children: ReactNode }) {
  const [fontSize, setFontSize] = useState<FontSize>("medium");
  const [fontFamily, setFontFamily] = useState<FontFamily>("sans");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.fontSize) setFontSize(saved.fontSize);
        if (saved.fontFamily) setFontFamily(saved.fontFamily);
      }
    } catch {}
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ fontSize, fontFamily }));
  }, [fontSize, fontFamily, mounted]);

  return (
    <ReadingSettingsContext.Provider value={{ fontSize, fontFamily, setFontSize, setFontFamily }}>
      <div
        style={{
          fontSize: fontSizeMap[fontSize],
          fontFamily: fontFamilyMap[fontFamily],
        }}
      >
        {children}
      </div>
    </ReadingSettingsContext.Provider>
  );
}
