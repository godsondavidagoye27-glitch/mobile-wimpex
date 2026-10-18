export function getSingleRouteParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    if (value.length !== 1 || typeof value[0] !== 'string') return null;
    value = value[0];
  }
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function isUuidRouteParam(value: string | null): value is string {
  return value !== null
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
