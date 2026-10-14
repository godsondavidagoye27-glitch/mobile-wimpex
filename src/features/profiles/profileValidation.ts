export function validateProfileLink(value: string): string | null {
  const link = value.trim();
  if (!link) return null;
  if (link.length > 100 || !/^https:\/\//i.test(link)) {
    return 'Enter a link that starts with https://';
  }
  try {
    const parsed = new URL(link);
    return parsed.protocol === 'https:' && parsed.hostname ? null : 'Enter a link that starts with https://';
  } catch {
    return 'Enter a link that starts with https://';
  }
}
