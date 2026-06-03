import { NextResponse } from "next/server";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateLimitEntry>();

const RATE_LIMIT_BODY = {
  error: "Too many requests. Please wait a moment and try again.",
};

function cleanupExpiredEntries(now: number) {
  store.forEach((entry, key) => {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  });
}

/** Returns 429 when over limit; otherwise null and records the request. */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): NextResponse | null {
  const now = Date.now();
  cleanupExpiredEntries(now);

  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  if (entry.count >= limit) {
    return NextResponse.json(RATE_LIMIT_BODY, { status: 429 });
  }

  entry.count += 1;
  return null;
}
