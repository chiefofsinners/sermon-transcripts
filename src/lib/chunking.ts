const CHUNK_SIZE = 500; // words
const CHUNK_OVERLAP = 50; // words

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Split transcript into chunks of ~CHUNK_SIZE words, breaking at paragraph
 * or sentence boundaries. Consecutive short paragraphs are merged together;
 * long paragraphs are split at sentence boundaries within them.
 */
export function chunkTranscript(transcript: string): string[] {
  if (wordCount(transcript) <= CHUNK_SIZE) return [transcript.trim()];

  // Split into paragraphs (double-newline or more)
  const paragraphs = transcript
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  // Further split long paragraphs into sentences
  const segments: string[] = [];
  for (const para of paragraphs) {
    if (wordCount(para) <= CHUNK_SIZE) {
      segments.push(para);
    } else {
      // Split on sentence boundaries: period/question/exclamation followed by space + uppercase
      const sentences = para.match(/[^.!?]*[.!?]+(?:\s|$)|[^.!?]+$/g) || [para];
      for (const s of sentences) {
        const trimmed = s.trim();
        if (trimmed) segments.push(trimmed);
      }
    }
  }

  // Greedily merge segments into chunks up to CHUNK_SIZE words
  const chunks: string[] = [];
  let current = "";
  for (const segment of segments) {
    const combined = current ? current + "\n\n" + segment : segment;
    if (wordCount(combined) <= CHUNK_SIZE) {
      current = combined;
    } else {
      // If the current buffer has content, flush it
      if (current) {
        chunks.push(current);
        // Start next chunk with overlap: take trailing sentences from previous chunk
        const overlapText = getOverlapSuffix(current, CHUNK_OVERLAP);
        current = overlapText ? overlapText + "\n\n" + segment : segment;
      } else {
        // Single segment exceeds CHUNK_SIZE — include it as-is
        chunks.push(segment);
        current = "";
      }
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

/** Extract roughly `targetWords` words from the end of text, snapping to sentence boundary. */
function getOverlapSuffix(text: string, targetWords: number): string {
  const sentences = text.match(/[^.!?]*[.!?]+(?:\s|$)|[^.!?]+$/g);
  if (!sentences) return "";

  let result = "";
  // Walk backwards through sentences to build overlap
  for (let i = sentences.length - 1; i >= 0; i--) {
    const candidate = sentences[i].trim() + (result ? " " + result : "");
    if (wordCount(candidate) > targetWords && result) break;
    result = candidate;
  }
  return result;
}

/** Build the text sent to the embedding model — includes metadata so
 *  queries mentioning a preacher, title, or passage rank correctly. */
export function embeddingText(metadata: {
  title: string;
  preacher: string;
  bibleText: string;
  preachDate: string;
  series: string;
  subtitle: string;
  keywords: string;
}, chunkText: string): string {
  const parts = [metadata.title, metadata.preacher, metadata.bibleText, metadata.preachDate, metadata.series, metadata.subtitle, metadata.keywords];
  const header = parts.filter(Boolean).join(" | ");
  return `${header}\n\n${chunkText}`;
}
