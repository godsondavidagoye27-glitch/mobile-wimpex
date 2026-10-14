export const recentSearchLimit = 10;

export function normalizeRecentSearches(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Recent searches are stored in an invalid format.');
  }

  const seen = new Set<string>();
  const searches: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new Error('Recent searches are stored in an invalid format.');
    }
    const search = item.trim();
    const key = search.toLocaleLowerCase();
    if (!search || seen.has(key)) continue;
    seen.add(key);
    searches.push(search);
    if (searches.length === recentSearchLimit) break;
  }
  return searches;
}

export function addRecentSearch(searches: readonly string[], value: string): string[] {
  return normalizeRecentSearches([value, ...searches]);
}

export function removeRecentSearch(searches: readonly string[], value: string): string[] {
  const normalizedValue = value.toLocaleLowerCase();
  return normalizeRecentSearches(searches).filter(
    (search) => search.toLocaleLowerCase() !== normalizedValue,
  );
}
