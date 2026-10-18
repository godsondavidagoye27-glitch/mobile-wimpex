export type VerifiedMap = Record<string, boolean>;
type VerifiedRecord = { id: string; is_verified: boolean };
type VerifiedQuery = (ids: string[]) => Promise<VerifiedRecord[]>;
type WaitingRequest = {
  ids: string[];
  resolve: (result: VerifiedMap) => void;
  reject: (error: unknown) => void;
};

export function createVerifiedMapLoader(
  query: VerifiedQuery,
  ttlMs = 30_000,
  now = Date.now,
) {
  const cache = new Map<string, { verified: boolean; expiresAt: number }>();
  let queuedIds = new Set<string>();
  let requests: WaitingRequest[] = [];
  let scheduled = false;

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    void Promise.resolve().then(async () => {
      const ids = [...queuedIds];
      const batch = requests;
      queuedIds = new Set();
      requests = [];
      scheduled = false;
      try {
        const records = await query(ids);
        const returned = new Map(records.map(({ id, is_verified }) => [id, is_verified]));
        for (const id of ids) {
          cache.set(id, { verified: returned.get(id) ?? false, expiresAt: now() + ttlMs });
        }
        for (const request of batch) {
          request.resolve(Object.fromEntries(request.ids.map((id) => [
            id,
            cache.get(id)?.verified ?? false,
          ])));
        }
      } catch (error) {
        for (const request of batch) request.reject(error);
      }
      if (queuedIds.size > 0) schedule();
    });
  };

  return async (inputIds: string[]): Promise<VerifiedMap> => {
    const ids = [...new Set(inputIds.filter(Boolean))];
    const result: VerifiedMap = {};
    const missing: string[] = [];
    for (const id of ids) {
      const value = cache.get(id);
      if (value && value.expiresAt > now()) result[id] = value.verified;
      else missing.push(id);
    }
    if (!missing.length) return result;

    const pending = new Promise<VerifiedMap>((resolve, reject) => {
      requests.push({ ids: missing, resolve, reject });
      for (const id of missing) queuedIds.add(id);
      schedule();
    });
    return { ...result, ...await pending };
  };
}
