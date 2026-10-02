function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

function parseApiKeys(raw: string | undefined): Map<string, string> {
  const keys = new Map<string, string>();
  for (const entry of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const idx = entry.indexOf(":");
    if (idx <= 0 || idx === entry.length - 1) {
      throw new Error(`Invalid GATEWAY_API_KEYS entry "${entry.split(":")[0]}" (expected clientId:secret)`);
    }
    keys.set(entry.slice(idx + 1), entry.slice(0, idx));
  }
  return keys;
}

export interface Config {
  port: number;
  apiKeys: Map<string, string>;
  rateLimit: { max: number; windowMs: number };
  cache: { ttlMs: number; maxEntries: number };
  maxInputChars: number;
}

export function loadConfig(): Config {
  const apiKeys = parseApiKeys(process.env.GATEWAY_API_KEYS);
  if (apiKeys.size === 0) {
    throw new Error("GATEWAY_API_KEYS must define at least one clientId:secret pair");
  }
  return {
    port: int("PORT", 8080),
    apiKeys,
    rateLimit: { max: int("RATE_LIMIT_MAX", 60), windowMs: int("RATE_LIMIT_WINDOW_MS", 60_000) },
    cache: { ttlMs: int("CACHE_TTL_MS", 300_000), maxEntries: int("CACHE_MAX_ENTRIES", 500) },
    maxInputChars: int("MAX_INPUT_CHARS", 50_000),
  };
}
