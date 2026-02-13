import { ImageResponse } from "next/og";
import { readFileSync } from "fs";
import { join } from "path";
import { SITE_TITLE } from "@/lib/siteConfig";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = SITE_TITLE;

export default function OgImage() {
  const logoData = readFileSync(
    join(process.cwd(), "public", "logo.png")
  );
  const logoBase64 = `data:image/png;base64,${logoData.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#ffffff",
          gap: 24,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoBase64} alt="" width={320} height={320} />
        <div
          style={{
            display: "flex",
            fontSize: 28,
            color: "#6b7280",
            marginTop: 8,
          }}
        >
          Sermon Transcripts
        </div>
      </div>
    ),
    { ...size }
  );
}
