const wait = (duration: number) => new Promise<void>((resolve) => setTimeout(resolve, duration));

export async function runWithMinimumDuration<T>(
  request: () => Promise<T>,
  minimumDuration = 500,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await request();
    const remaining = Math.max(0, minimumDuration - (Date.now() - startedAt));
    if (remaining) await wait(remaining);
    return result;
  } catch (error) {
    const remaining = Math.max(0, minimumDuration - (Date.now() - startedAt));
    if (remaining) await wait(remaining);
    throw error;
  }
}
