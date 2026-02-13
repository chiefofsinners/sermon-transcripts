import OpenAI from "openai";
import { toFile } from "openai";

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// Whisper transcription
// ---------------------------------------------------------------------------

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * Transcribe an audio buffer using OpenAI Whisper.
 * Returns a formatted transcript with paragraph breaks.
 *
 * Uses verbose_json to get segment timestamps for intelligent
 * paragraph splitting based on pauses in speech.
 */
export async function transcribeWithWhisper(
  buffer: Buffer,
  filename = "audio.mp3",
): Promise<string> {
  const client = getClient();

  const file = await toFile(buffer, filename, { type: "audio/mpeg" });

  const response = await client.audio.transcriptions.create({
    model: "whisper-1",
    file,
    language: "en",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const segments: WhisperSegment[] =
    (response as unknown as { segments?: WhisperSegment[] }).segments ?? [];

  if (segments.length === 0) {
    // Fallback: return the plain text if no segments
    return (response as unknown as { text?: string }).text ?? "";
  }

  return formatTranscript(segments);
}

// ---------------------------------------------------------------------------
// Transcript formatting
// ---------------------------------------------------------------------------

const PAUSE_THRESHOLD = 2.0; // seconds of silence → paragraph break
const SENTENCES_PER_PARA = 4;

/**
 * Build a readable transcript from Whisper segments.
 *
 * 1. Group segments by detecting pauses ≥ PAUSE_THRESHOLD seconds.
 * 2. Within each group, split into paragraphs every ~SENTENCES_PER_PARA
 *    sentence-ending punctuation marks.
 */
function formatTranscript(segments: WhisperSegment[]): string {
  if (segments.length === 0) return "";

  // Group segments by pauses
  const groups: string[][] = [[]];
  for (let i = 0; i < segments.length; i++) {
    groups[groups.length - 1].push(segments[i].text.trim());

    if (i < segments.length - 1) {
      const gap = segments[i + 1].start - segments[i].end;
      if (gap >= PAUSE_THRESHOLD) {
        groups.push([]);
      }
    }
  }

  // Split each group into paragraphs by sentence count
  const paragraphs: string[] = [];
  for (const group of groups) {
    const joined = group.join(" ").replace(/\s{2,}/g, " ").trim();
    if (!joined) continue;

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

function capitaliseStart(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
