import { router, type Href } from 'expo-router';

/**
 * router.back() silently does nothing when a screen has no history (opened from a
 * notification, share link, or after a stack reset), which feels like a frozen
 * back button. Fall back to the home tab instead.
 */
export function goBack(fallback: Href = '/(tabs)') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}