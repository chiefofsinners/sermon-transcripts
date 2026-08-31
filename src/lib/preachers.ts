/**
 * SermonAudio sometimes holds the same person under more than one speaker
 * record, so their sermons arrive under slightly different display names
 * (e.g. "Chris Richards" / speakerID 66551 vs "Dr. Chris Richards" /
 * speakerID 29630). Left alone, that splits a preacher in two: the filter
 * dropdown lists them twice, and the AI agent's `preacher` filter only ever
 * sees half the catalogue.
 *
 * The sermon JSON in data/ keeps whatever SermonAudio returned — canonicalising
 * happens on the way into the search index and the vector store, so a
 * re-download never reintroduces the split.
 *
 * Add an entry per duplicated speaker. Keys are lowercased and trimmed; the
 * value is the display name you want to keep:
 *
 *   const PREACHER_ALIASES: Record<string, string> = {
 *     "chris richards": "Dr. Chris Richards",
 *     "bill schweitzer": "Dr. Bill Schweitzer",
 *   };
 *
 * To find duplicates in your own data, look for two preacher names in
 * public/filters.json that differ only by a title.
 */
const PREACHER_ALIASES: Record<string, string> = {};

export function canonicalPreacher(name: string | null | undefined): string {
  const raw = (name ?? "").trim();
  if (!raw) return "Unknown";
  return PREACHER_ALIASES[raw.toLowerCase()] ?? raw;
}
