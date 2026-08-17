export interface SearchableEntry {
  id: string;
  pageTitle: string;
  pageUrl: string;
}

export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/** An entry matches when every query token appears in its title, URL, or recognized text. */
export function entryMatches(
  entry: SearchableEntry,
  recognizedText: string | undefined,
  tokens: string[]
): boolean {
  if (tokens.length === 0) return true;
  const haystack = `${entry.pageTitle}\n${entry.pageUrl}\n${recognizedText ?? ""}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function filterEntries<T extends SearchableEntry>(
  entries: readonly T[],
  recognizedTexts: ReadonlyMap<string, string>,
  query: string
): T[] {
  const tokens = tokenizeQuery(query);
  return entries.filter((entry) => entryMatches(entry, recognizedTexts.get(entry.id), tokens));
}
