import { v2 } from "@google-cloud/speech";
import { Storage } from "@google-cloud/storage";

const BUCKET_NAME = process.env.GCS_BUCKET_NAME || "";
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || "";

/**
 * Parse credentials from env. Supports three modes:
 *  - GOOGLE_APPLICATION_CREDENTIALS (path to key file — handled automatically by SDK)
 *  - GOOGLE_CREDENTIALS_BASE64 (base64-encoded JSON — for Vercel)
 *  - GOOGLE_CREDENTIALS (raw JSON string — alternative for environments that support it)
 */
function getCredentials(): Record<string, unknown> | undefined {
  if (process.env.GOOGLE_CREDENTIALS_BASE64) {
    const json = Buffer.from(
      process.env.GOOGLE_CREDENTIALS_BASE64,
      "base64",
    ).toString("utf-8");
    return JSON.parse(json);
  }
  if (process.env.GOOGLE_CREDENTIALS) {
    return JSON.parse(process.env.GOOGLE_CREDENTIALS);
  }
  return undefined;
}

let _storage: Storage | null = null;
let _speech: v2.SpeechClient | null = null;

function getStorage(): Storage {
  if (!_storage) {
    const creds = getCredentials();
    _storage = creds ? new Storage({ credentials: creds }) : new Storage();
  }
  return _storage;
}

function getSpeechClient(): v2.SpeechClient {
  if (!_speech) {
    const creds = getCredentials();
    _speech = creds
      ? new v2.SpeechClient({ credentials: creds })
      : new v2.SpeechClient();
  }
  return _speech;
}

// ---------------------------------------------------------------------------
// Google Cloud Storage — files
// ---------------------------------------------------------------------------

/** Upload a Buffer to GCS and return its gs:// URI. */
export async function uploadBufferToGCS(
  buffer: Buffer,
  destination: string,
  contentType = "audio/mpeg",
): Promise<string> {
  const storage = getStorage();
  const file = storage.bucket(BUCKET_NAME).file(destination);
  await file.save(buffer, { contentType });
  return `gs://${BUCKET_NAME}/${destination}`;
}

/**
 * Generate a V4 signed URL that allows the browser to upload
 * a file directly to GCS (bypasses Vercel's 4.5 MB body limit).
 */
export async function getSignedUploadUrl(
  destination: string,
  contentType = "audio/mpeg",
): Promise<string> {
  const storage = getStorage();
  const [url] = await storage
    .bucket(BUCKET_NAME)
    .file(destination)
    .getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + 30 * 60 * 1000, // 30 minutes
      contentType,
    });
  return url;
}

/** Return the gs:// URI for a GCS path. */
export function gcsUri(destination: string): string {
  return `gs://${BUCKET_NAME}/${destination}`;
}

/** Download a file from GCS into a Buffer. */
export async function downloadFromGCS(destination: string): Promise<Buffer> {
  const storage = getStorage();
  const [contents] = await storage
    .bucket(BUCKET_NAME)
    .file(destination)
    .download();
  return contents;
}

/** Best-effort delete of a GCS object. */
export async function deleteFromGCS(destination: string): Promise<void> {
  const storage = getStorage();
  await storage
    .bucket(BUCKET_NAME)
    .file(destination)
    .delete()
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Google Cloud Storage — pending jobs
// ---------------------------------------------------------------------------

export interface PendingJob {
  sermonId: string;
  operationName?: string;
  type?: "whisper" | "speech";
  gcsAudioPath: string;
  metadata: Record<string, string>;
  submittedAt: string;
  status?: "processing" | "completed" | "error";
  result?: {
    sermonData: Record<string, unknown>;
    committed: boolean;
    commitError?: string;
  };
  error?: string;
}

const PENDING_PREFIX = "pending-jobs/";

/** Save a pending job record to GCS. */
export async function savePendingJob(job: PendingJob): Promise<void> {
  const storage = getStorage();
  const file = storage
    .bucket(BUCKET_NAME)
    .file(`${PENDING_PREFIX}${job.sermonId}.json`);
  await file.save(JSON.stringify(job, null, 2), {
    contentType: "application/json",
  });
}

/** List all pending job records from GCS. */
export async function listPendingJobs(): Promise<PendingJob[]> {
  const storage = getStorage();
  const [files] = await storage
    .bucket(BUCKET_NAME)
    .getFiles({ prefix: PENDING_PREFIX });

  const jobs: PendingJob[] = [];
  for (const file of files) {
    if (!file.name.endsWith(".json")) continue;
    const [contents] = await file.download();
    jobs.push(JSON.parse(contents.toString("utf-8")));
  }

  return jobs.sort(
    (a, b) =>
      new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  );
}

/** Read a single pending job from GCS. */
export async function getPendingJob(sermonId: string): Promise<PendingJob | null> {
  try {
    const storage = getStorage();
    const [contents] = await storage
      .bucket(BUCKET_NAME)
      .file(`${PENDING_PREFIX}${sermonId}.json`)
      .download();
    return JSON.parse(contents.toString("utf-8"));
  } catch {
    return null;
  }
}

/** Update fields on an existing pending job in GCS. */
export async function updatePendingJob(
  sermonId: string,
  updates: Partial<PendingJob>,
): Promise<void> {
  const storage = getStorage();
  const file = storage
    .bucket(BUCKET_NAME)
    .file(`${PENDING_PREFIX}${sermonId}.json`);
  const [contents] = await file.download();
  const job = JSON.parse(contents.toString("utf-8"));
  const updated = { ...job, ...updates };
  await file.save(JSON.stringify(updated, null, 2), {
    contentType: "application/json",
  });
}

/** Delete a pending job record from GCS. */
export async function deletePendingJob(sermonId: string): Promise<void> {
  await deleteFromGCS(`${PENDING_PREFIX}${sermonId}.json`);
}

// ---------------------------------------------------------------------------
// Transcript post-processing
// ---------------------------------------------------------------------------

interface SpeechResult {
  alternatives?: Array<{
    transcript?: string;
    words?: Array<{
      word?: string;
      startOffset?: { seconds?: string | number; nanos?: number };
      endOffset?: { seconds?: string | number; nanos?: number };
    }>;
  }>;
  resultEndOffset?: { seconds?: string | number; nanos?: number };
}

/** Parse a protobuf Duration-like offset to seconds. */
function offsetToSeconds(
  offset?: { seconds?: string | number; nanos?: number },
): number {
  if (!offset) return 0;
  const s =
    typeof offset.seconds === "string"
      ? parseFloat(offset.seconds)
      : offset.seconds ?? 0;
  return s + (offset.nanos ?? 0) / 1e9;
}

/**
 * Build a readable transcript from Speech-to-Text V2 results.
 *
 * Strategy:
 *  1. Detect gaps between consecutive segments (API "results").
 *     A gap ≥ PAUSE_THRESHOLD seconds suggests a natural paragraph break.
 *  2. Within each group, join the segment texts and then split into
 *     paragraphs every ~SENTENCES_PER_PARA sentence-ending punctuation marks.
 *  3. Clean up whitespace and capitalisation after periods.
 */
const PAUSE_THRESHOLD = 2.0; // seconds of silence to trigger a paragraph break
const SENTENCES_PER_PARA = 4;

function formatTranscript(results: SpeechResult[]): string {
  // Collect segment texts with their timing info
  const segments: { text: string; startSec: number; endSec: number }[] = [];
  for (const r of results) {
    const text = r.alternatives?.[0]?.transcript?.trim();
    if (!text) continue;

    const words = r.alternatives?.[0]?.words;
    const startSec = words?.[0]
      ? offsetToSeconds(words[0].startOffset)
      : 0;
    const endSec = words?.length
      ? offsetToSeconds(words[words.length - 1].endOffset)
      : offsetToSeconds(r.resultEndOffset);

    segments.push({ text, startSec, endSec });
  }

  if (segments.length === 0) return "";

  // Group segments into chunks separated by pauses
  const groups: string[][] = [[]];
  for (let i = 0; i < segments.length; i++) {
    groups[groups.length - 1].push(segments[i].text);

    if (i < segments.length - 1) {
      const gap = segments[i + 1].startSec - segments[i].endSec;
      if (gap >= PAUSE_THRESHOLD) {
        groups.push([]);
      }
    }
  }

  // Within each pause-delimited group, further split into paragraphs
  // every N sentence-ending punctuation marks.
  const paragraphs: string[] = [];
  for (const group of groups) {
    const joined = group.join(" ").replace(/\s{2,}/g, " ").trim();
    if (!joined) continue;

    // Split at sentence boundaries (.!?) followed by a space and an
    // uppercase letter, keeping the punctuation with the preceding sentence.
    const sentences = joined.match(/[^.!?]*[.!?]+(?:\s|$)/g);

    if (!sentences || sentences.length <= SENTENCES_PER_PARA) {
      paragraphs.push(capitaliseStart(joined));
      continue;
    }

    for (let i = 0; i < sentences.length; i += SENTENCES_PER_PARA) {
      const chunk = sentences
        .slice(i, i + SENTENCES_PER_PARA)
        .join("")
        .trim();
      if (chunk) paragraphs.push(capitaliseStart(chunk));
    }
  }

  return paragraphs.join("\n\n");
}

/** Ensure the first character of a string is uppercase. */
function capitaliseStart(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Google Cloud Speech-to-Text V2 — batchRecognize with dynamic batching
// ---------------------------------------------------------------------------

/**
 * Start a V2 batch transcription job with dynamic batching for an MP3 in GCS.
 * Dynamic batching provides lower-cost transcription with higher latency
 * (up to 24 hours).
 * Returns the operation name to check later.
 */
export async function startTranscription(gcsUri: string): Promise<string> {
  const client = getSpeechClient();

  const recognizer = `projects/${PROJECT_ID}/locations/global/recognizers/_`;

  const [operation] = await client.batchRecognize({
    recognizer,
    config: {
      autoDecodingConfig: {},
      languageCodes: ["en-GB"],
      model: "latest_long",
      features: {
        enableAutomaticPunctuation: true,
        enableWordTimeOffsets: true,
      },
    },
    files: [{ uri: gcsUri }],
    recognitionOutputConfig: {
      inlineResponseConfig: {},
    },
    processingStrategy: "DYNAMIC_BATCHING",
  });

  if (!operation.name) {
    throw new Error("Batch transcription operation did not return a name");
  }

  return operation.name;
}

/**
 * Check the status of a V2 batch transcription operation.
 */
export async function checkTranscriptionStatus(
  operationName: string,
): Promise<
  | { done: true; transcript: string }
  | { done: false; progressPercent: number }
> {
  const client = getSpeechClient();
  const decodedOp = await client.checkBatchRecognizeProgress(operationName);

  if (decodedOp.done) {
    // Cast result to the expected V2 BatchRecognizeResponse shape
    const response = decodedOp.result as {
      results?: Record<
        string,
        {
          transcript?: {
            results?: Array<{
              alternatives?: Array<{
                transcript?: string;
                words?: Array<{
                  word?: string;
                  startOffset?: { seconds?: string | number; nanos?: number };
                  endOffset?: { seconds?: string | number; nanos?: number };
                }>;
              }>;
              resultEndOffset?: { seconds?: string | number; nanos?: number };
            }>;
          };
        }
      >;
    } | null;

    // V2 batch results are keyed by the input URI
    let transcript = "";
    if (response?.results) {
      for (const [, fileResult] of Object.entries(response.results)) {
        if (fileResult.transcript?.results) {
          transcript = formatTranscript(fileResult.transcript.results);
        }
      }
    }

    return { done: true, transcript };
  }

  const meta = decodedOp.metadata as {
    progressPercent?: number;
  } | null;

  return { done: false, progressPercent: meta?.progressPercent ?? 0 };
}
