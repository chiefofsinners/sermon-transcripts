import { NextResponse, after } from "next/server";
import {
  downloadFromGCS,
  deleteFromGCS,
  savePendingJob,
  updatePendingJob,
} from "@/lib/google-cloud";
import { transcribeWithWhisper } from "@/lib/openai";
import { commitSermonToGitHub } from "@/lib/github";
import { verifyAuth } from "@/lib/upload-auth";

/** Allow up to 5 min for download + transcription + commit. */
export const maxDuration = 300;

/**
 * POST — Accept an MP3 already uploaded to GCS, save a pending job,
 * then transcribe with Whisper and commit in the background via after().
 *
 * Returns immediately so the user can upload another sermon.
 *
 * Accepts JSON { sermonId, gcsAudioPath, metadata }. Auth via cookie.
 */
export async function POST(request: Request) {
  try {
    if (!(await verifyAuth(request))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sermonId, gcsAudioPath, metadata } = await request.json();

    if (!sermonId || !gcsAudioPath) {
      return NextResponse.json(
        { error: "Missing sermonId or gcsAudioPath" },
        { status: 400 },
      );
    }

    if (!metadata) {
      return NextResponse.json(
        { error: "No metadata provided" },
        { status: 400 },
      );
    }

    // ---- Save pending job immediately ----
    const pendingJob = {
      sermonId,
      type: "whisper" as const,
      gcsAudioPath,
      metadata,
      submittedAt: new Date().toISOString(),
      status: "processing" as const,
    };
    await savePendingJob(pendingJob);

    // ---- Schedule background transcription ----
    after(async () => {
      try {
        // Download MP3 from GCS
        const audioBuffer = await downloadFromGCS(gcsAudioPath);

        // Transcribe with Whisper
        const transcript = await transcribeWithWhisper(
          audioBuffer,
          `${sermonId}.mp3`,
        );

        // Build sermon data
        const meta = metadata;
        const eventType = meta.amPm
          ? `${meta.eventType || "Sunday Service"} - ${meta.amPm}`
          : meta.eventType || null;

        const sermonData = {
          sermonID: sermonId,
          title: meta.title || "",
          displayTitle: meta.title || "",
          preacher: meta.preacher || "",
          preacherID: null,
          preachDate: meta.date || null,
          bibleText: meta.bibleText || null,
          series: meta.series || null,
          eventType,
          keywords: meta.keywords || null,
          subtitle: meta.summary || null,
          moreInfoText: meta.summary || null,
          transcript,
        };

        // Commit to GitHub
        let committed = false;
        let commitError: string | undefined;
        try {
          await commitSermonToGitHub(sermonId, sermonData);
          committed = true;
        } catch (err) {
          console.error("GitHub commit failed:", err);
          commitError =
            err instanceof Error ? err.message : "GitHub commit failed";
        }

        // Update pending job with result
        await updatePendingJob(sermonId, {
          status: "completed",
          result: { sermonData, committed, commitError },
        });

        // Clean up GCS audio file
        deleteFromGCS(gcsAudioPath).catch(() => {});
      } catch (err) {
        console.error("Background transcription error:", err);
        await updatePendingJob(sermonId, {
          status: "error",
          error: err instanceof Error ? err.message : "Transcription failed",
        }).catch(() => {});
      }
    });

    // ---- Return immediately ----
    return NextResponse.json({
      sermonId,
      pending: true,
      job: pendingJob,
    });
  } catch (err: unknown) {
    console.error("Upload error:", err);
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
