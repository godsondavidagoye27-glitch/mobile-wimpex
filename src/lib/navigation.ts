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

/**
 * Leave the current flow and land on the home tab with a clean stack. Use this
 * instead of router.replace() between screens with different presentations
 * (card <-> transparentModal): that combination can leave a stale screen behind
 * the new one, which reappears on the next back and shows a broken screen.
 */
export function closeToHome() {
  if (router.canDismiss()) router.dismissAll();
  else router.replace('/(tabs)');
}