export type SignedUrlResult = {
  path: string;
  signedUrl: string | null;
  error?: unknown;
};

export function mapSignedUrlResults(
  paths: readonly string[],
  results: readonly SignedUrlResult[] | null,
): Map<string, string | null> {
  const urls = new Map<string, string | null>(paths.map((path) => [path, null]));
  if (!results) return urls;
  results.forEach((result, index) => {
    const requestedPath = paths[index];
    if (requestedPath && result.path === requestedPath && !result.error && result.signedUrl) {
      urls.set(requestedPath, result.signedUrl);
    }
  });
  return urls;
}
