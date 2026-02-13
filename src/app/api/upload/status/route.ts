import { NextResponse } from "next/server";
import {
  listPendingJobs,
  checkTranscriptionStatus,
  deletePendingJob,
  deleteFromGCS,
  getPendingJob,
} from "@/lib/google-cloud";
import { commitSermonToGitHub } from "@/lib/github";
import { verifyAuth } from "@/lib/upload-auth";

/**
 * GET — list all pending jobs and their current status.
 * POST — check a specific job; if complete, save sermon JSON and clean up.
 *        Handles both Whisper (type=whisper) and Google Cloud Speech jobs.
 * Auth via cookie.
 */

export async function GET(request: Request) {
  if (!(await verifyAuth(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const jobs = await listPendingJobs();
    return NextResponse.json({ jobs });
  } catch (err: unknown) {
    console.error("List pending jobs error:", err);
    const message = err instanceof Error ? err.message : "Failed to list jobs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!(await verifyAuth(request))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { sermonId, operationName, gcsAudioPath, metadata, action } = body;

    // ---- Delete a stale/broken pending job ----
    if (action === "delete") {
      if (!sermonId) {
        return NextResponse.json({ error: "Missing sermonId" }, { status: 400 });
      }
      await deletePendingJob(sermonId).catch(() => {});
      if (gcsAudioPath) deleteFromGCS(gcsAudioPath).catch(() => {});
      return NextResponse.json({ deleted: true });
    }

    if (!operationName || !sermonId) {
      // ---- Whisper job: check pending job file for completion ----
      if (sermonId) {
        const job = await getPendingJob(sermonId);
        if (!job) {
          return NextResponse.json({
            done: false,
            error: "Job not found. It may have been deleted.",
          });
        }

        if (job.status === "completed" && job.result) {
          // Clean up
          await deletePendingJob(sermonId).catch(() => {});
          if (job.gcsAudioPath) deleteFromGCS(job.gcsAudioPath).catch(() => {});

          return NextResponse.json({
            done: true,
            sermonId,
            sermonData: job.result.sermonData,
            committed: job.result.committed,
            commitError: job.result.commitError,
          });
        }

        if (job.status === "error") {
          return NextResponse.json({
            done: false,
            error: job.error || "Transcription failed",
          });
        }

        // Still processing
        return NextResponse.json({ done: false });
      }

      return NextResponse.json(
        { error: "Missing operationName or sermonId" },
        { status: 400 },
      );
    }

    let status;
    try {
      status = await checkTranscriptionStatus(operationName);
    } catch (err) {
      console.error(`Failed to check operation ${operationName}:`, err);
      return NextResponse.json({
        done: false,
        error: "Operation not found or expired. You can delete this job.",
        progressPercent: 0,
      });
    }

    if (!status.done) {
      return NextResponse.json({
        done: false,
        progressPercent: status.progressPercent,
      });
    }

    // ---- Transcription complete — build & save sermon JSON ----
    const meta = metadata || {};

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
      transcript: status.transcript,
    };

    // ---- Commit sermon JSON to GitHub (triggers Vercel rebuild) ----
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

    // ---- Clean up GCS ----
    await deletePendingJob(sermonId).catch(() => {});
    if (gcsAudioPath) deleteFromGCS(gcsAudioPath).catch(() => {});

    return NextResponse.json({
      done: true,
      sermonId,
      sermonData,
      committed,
      commitError,
    });
  } catch (err: unknown) {
    console.error("Check status error:", err);
    const message = err instanceof Error ? err.message : "Status check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
