const fallbackBaseUrl = 'https://wimpex.example';

function getBaseUrl(configuredBaseUrl = process.env.EXPO_PUBLIC_WEB_BASE_URL) {
  const value = configuredBaseUrl?.trim() || fallbackBaseUrl;
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') throw new Error('EXPO_PUBLIC_WEB_BASE_URL must use HTTPS.');
  return parsed.toString().replace(/\/$/, '');
}

export function createPostShareUrl(postId: string, baseUrl?: string) {
  return `${getBaseUrl(baseUrl)}/post/${encodeURIComponent(postId)}`;
}

export function createProfileShareUrl(username: string, baseUrl?: string) {
  return `${getBaseUrl(baseUrl)}/user/${encodeURIComponent(username)}`;
}
