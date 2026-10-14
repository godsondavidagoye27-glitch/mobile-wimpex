import { Storage } from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';
import { normalizeRecentSearches } from './recentSearches';

const recentSearchesKey = 'wimpex:search:recent';

export async function loadRecentSearches(): Promise<string[]> {
  const stored = Platform.OS === 'web'
    ? globalThis.localStorage.getItem(recentSearchesKey)
    : await Storage.getItem(recentSearchesKey);
  if (stored === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (error) {
    throw new Error('Recent searches could not be read.', { cause: error });
  }
  return normalizeRecentSearches(parsed);
}

export async function saveRecentSearches(searches: readonly string[]): Promise<void> {
  const serialized = JSON.stringify(normalizeRecentSearches(searches));
  if (Platform.OS === 'web') {
    globalThis.localStorage.setItem(recentSearchesKey, serialized);
    return;
  }
  await Storage.setItem(recentSearchesKey, serialized);
}

export async function clearRecentSearches(): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage.removeItem(recentSearchesKey);
    return;
  }
  await Storage.removeItem(recentSearchesKey);
}
