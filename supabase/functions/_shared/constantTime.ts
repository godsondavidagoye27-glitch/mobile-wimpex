export function constantTimeEquals(candidate: string | null, expected: string): boolean {
  if (candidate === null) return false;
  const encoder = new TextEncoder();
  const candidateBytes = encoder.encode(candidate);
  const expectedBytes = encoder.encode(expected);
  const length = Math.max(candidateBytes.length, expectedBytes.length);
  let difference = candidateBytes.length ^ expectedBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (candidateBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }

  return difference === 0;
}
