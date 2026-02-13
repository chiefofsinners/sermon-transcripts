import { NextResponse } from "next/server";
import { getSignedUploadUrl } from "@/lib/google-cloud";
import { sermonFileExists } from "@/lib/github";
import { verifyAuth } from "@/lib/upload-auth";

/**
 * Build a date-based sermon ID from the upload metadata.
 * Examples: "2026-02-13-am", "2026-02-13-pm", "2026-02-13-prayer-meeting"
 * Falls back to a Unix timestamp if no date is provided.
 */
function buildSermonId(date?: string, amPm?: string, eventType?: string): string {
  if (!date) return String(Math.floor(Date.now() / 1000));

  if (eventType === "Prayer Meeting") return `${date}-prayer-meeting`;
  if (eventType === "Other") return date;

  // Sunday Service (default) — include am/pm
  return `${date}-${(amPm || "am").toLowerCase()}`;
}

/**
 * Return a unique sermon ID by appending -2, -3, … if the base ID
 * already exists in the GitHub repo.
 */
async function uniqueSermonId(baseId: string): Promise<string> {
  if (!(await sermonFileExists(baseId))) return baseId;
  for (let i = 2; i <= 10; i++) {
    const candidate = `${baseId}-${i}`;
    if (!(await sermonFileExists(candidate))) return candidate;
  }
  // Extremely unlikely — fall back to timestamp suffix
  return `${baseId}-${Math.floor(Date.now() / 1000)}`;
}

/**
 * POST — Generate a signed URL for direct browser → GCS upload.
 * Returns { sermonId, signedUrl, gcsAudioPath } so the client
 * can PUT the file straight to GCS, bypassing Vercel's 4.5 MB
 * body limit. Auth via cookie.
 *
 * Accepts JSON body { date, amPm, eventType } to build a
 * human-readable sermon ID.
 */
export async function POST(request: Request) {
  try {
    if (!(await verifyAuth(request))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { date, amPm, eventType } = await request.json().catch(() => ({}));
    const baseId = buildSermonId(date, amPm, eventType);
    const sermonId = await uniqueSermonId(baseId);
    const gcsAudioPath = `uploads/${sermonId}.mp3`;
    const signedUrl = await getSignedUploadUrl(gcsAudioPath);

    return NextResponse.json({ sermonId, signedUrl, gcsAudioPath });
  } catch (err: unknown) {
    console.error("Signed URL error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate upload URL";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
