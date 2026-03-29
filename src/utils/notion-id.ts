const UUID_WITH_DASHES =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_WITHOUT_DASHES = /^[0-9a-f]{32}$/i;

export function normalizeNotionId(value: string): string {
  const trimmed = value.trim();

  if (UUID_WITH_DASHES.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  if (UUID_WITHOUT_DASHES.test(trimmed)) {
    return [
      trimmed.slice(0, 8),
      trimmed.slice(8, 12),
      trimmed.slice(12, 16),
      trimmed.slice(16, 20),
      trimmed.slice(20),
    ].join("-").toLowerCase();
  }

  throw new Error(`Could not normalize Notion ID from "${value}"`);
}

export function maybeNormalizeNotionId(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return normalizeNotionId(value);
  } catch {
    return undefined;
  }
}

export function extractNotionIdFromUrl(value: string): string | undefined {
  if (value.startsWith("collection://") || value.startsWith("view://")) {
    const embeddedId = value.split("://")[1];
    return embeddedId ? maybeNormalizeNotionId(embeddedId) : undefined;
  }

  const direct = maybeNormalizeNotionId(value);
  if (direct) {
    return direct;
  }

  const match = value.match(
    /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i,
  );
  const matchedId = match?.[1];
  return matchedId ? normalizeNotionId(matchedId) : undefined;
}
