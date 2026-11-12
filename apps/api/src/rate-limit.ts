/** Small in-memory token bucket keyed by user id (single-process deployment). */
export function createRateLimiter({ capacity, refillPerSecond, maxKeys = 10_000 }: { capacity: number; refillPerSecond: number; maxKeys?: number }) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return {
    take(key: string, now = Date.now()): boolean {
      const b = buckets.get(key) ?? { tokens: capacity, at: now };
      b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 1000) * refillPerSecond);
      b.at = now;
      const allowed = b.tokens >= 1;
      if (allowed) b.tokens -= 1;
      buckets.delete(key);
      buckets.set(key, b);
      if (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value!);
      return allowed;
    },
  };
}
