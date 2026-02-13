const attempts = new Map<string, { count: number; resetTime: number }>();

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/** Check whether an IP is rate-limited. Call `recordFailure` after a failed attempt. */
export function isRateLimited(ip: string): {
  blocked: boolean;
  retryAfterSeconds?: number;
} {
  cleanup();
  const entry = attempts.get(ip);
  if (!entry) return { blocked: false };

  if (Date.now() > entry.resetTime) {
    attempts.delete(ip);
    return { blocked: false };
  }

  if (entry.count >= MAX_ATTEMPTS) {
    return {
      blocked: true,
      retryAfterSeconds: Math.ceil((entry.resetTime - Date.now()) / 1000),
    };
  }

  return { blocked: false };
}

/** Record a failed login attempt for the given IP. */
export function recordFailure(ip: string) {
  const now = Date.now();
  const entry = attempts.get(ip);

  if (!entry || now > entry.resetTime) {
    attempts.set(ip, { count: 1, resetTime: now + WINDOW_MS });
  } else {
    entry.count++;
  }
}

/** Remove expired entries to prevent memory leaks. */
function cleanup() {
  const now = Date.now();
  for (const [ip, entry] of attempts) {
    if (now > entry.resetTime) attempts.delete(ip);
  }
}
