import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { SITE_TITLE, CHURCH_NAME } from "@/lib/siteConfig";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL
    ? new URL(process.env.NEXT_PUBLIC_SITE_URL)
    : undefined,
  title: SITE_TITLE,
  description:
    `Search through sermon transcripts from ${CHURCH_NAME}. Find sermons by keyword, preacher, passage, or topic.`,
  openGraph: {
    title: SITE_TITLE,
    description:
      `Search through sermon transcripts from ${CHURCH_NAME}. Find sermons by keyword, preacher, passage, or topic.`,
    type: "website",
  },
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_TITLE,
  description: `Search through sermon transcripts from ${CHURCH_NAME}. Find sermons by keyword, preacher, passage, or topic.`,
  url: SITE_URL,
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${SITE_URL}/?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
  publisher: {
    "@type": "Organization",
    name: CHURCH_NAME,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="min-h-full bg-gray-50 dark:bg-gray-950" style={{ colorScheme: "light dark" }}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
      </head>
      <body className={`${geistSans.variable} font-sans antialiased min-h-dvh bg-gray-50 dark:bg-gray-950`}>
        {children}
      </body>
    </html>
  );
}
