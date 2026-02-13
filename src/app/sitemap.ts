import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { MetadataRoute } from "next";

const DATA_DIR = join(process.cwd(), "data", "sermons");
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export default function sitemap(): MetadataRoute.Sitemap {
  const sermonFiles = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));

  const sermonEntries: MetadataRoute.Sitemap = sermonFiles.map((file) => {
    const sermon = JSON.parse(readFileSync(join(DATA_DIR, file), "utf-8"));
    return {
      url: `${SITE_URL}/sermon/${sermon.sermonID}`,
      lastModified: sermon.preachDate,
    };
  });

  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
    },
    ...sermonEntries,
  ];
}
