/**
 * Parses a search query supporting quoted phrases.
 *   "kingdom of God" jesus  →  { phrases: ["kingdom of god"], terms: ["jesus"] }
 *   kingdom of God          →  { phrases: [], terms: ["kingdom", "of", "god"] }
 */
export function parseQuery(query: string): {
  phrases: string[];
  terms: string[];
} {
  const phrases: string[] = [];
  const terms: string[] = [];

  // Extract quoted phrases (double or single quotes)
  const remaining = query.replace(/["']([^"']+)["']/g, (_, phrase: string) => {
    const trimmed = phrase.trim().toLowerCase();
    if (trimmed.length >= 2) phrases.push(trimmed);
    return " ";
  });

  // Split the rest into individual terms
  for (const word of remaining.toLowerCase().split(/\s+/)) {
    if (word.length >= 2) terms.push(word);
  }

  return { phrases, terms };
}

/** Strips quotes from a query string so FlexSearch receives plain words. */
export function stripQuotes(query: string): string {
  return query.replace(/["']/g, "");
}
