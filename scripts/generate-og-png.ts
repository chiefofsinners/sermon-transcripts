import type React from "react";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const SIZE = 1024;

async function main() {
  const logoData = readFileSync(
    join(process.cwd(), "public", "logo.png")
  );
  const logoBase64 = `data:image/png;base64,${logoData.toString("base64")}`;

  // Use a system font for satori (it requires raw font data)
  // Fetch Inter from Google Fonts as a fallback-safe option
  const fontRes = await fetch(
    "https://fonts.googleapis.com/css2?family=Open+Sans:wght@400&display=swap"
  );
  const cssText = await fontRes.text();
  const fontUrlMatch = cssText.match(/src:\s*url\(([^)]+)\)/);
  let fontData: ArrayBuffer;
  if (fontUrlMatch) {
    const fontFileRes = await fetch(fontUrlMatch[1]);
    fontData = await fontFileRes.arrayBuffer();
  } else {
    // Fallback: try to load a local system font
    throw new Error("Could not fetch font from Google Fonts");
  }

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#ffffff",
          gap: 16,
        },
        children: [
          {
            type: "img",
            props: {
              src: logoBase64,
              alt: "",
              width: 700,
              height: 700,
            },
          },
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                fontSize: 52,
                color: "#374151",
                marginTop: 0,
              },
              children: "Sermon Transcripts",
            },
          },
        ],
      },
    } as React.ReactNode,
    {
      width: SIZE,
      height: SIZE,
      fonts: [
        {
          name: "Open Sans",
          data: fontData,
          weight: 400,
          style: "normal",
        },
      ],
    }
  );

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: SIZE },
  });
  const png = resvg.render().asPng();

  const outPath = join(process.cwd(), "public", "og-1024.png");
  writeFileSync(outPath, png);
  console.log(`Written ${outPath} (${png.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
