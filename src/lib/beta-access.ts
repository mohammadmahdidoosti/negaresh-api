// Server-only dependency: never import this module from a client component.
import { createHash, timingSafeEqual } from 'node:crypto';

export const BETA_COOKIE = 'beta_access';
export const BETA_MAX_AGE = 30 * 24 * 60 * 60;

export function getBetaSecret(): string | undefined {
  const configured = process.env.BETA_ACCESS_SECRET;
  if (configured?.trim()) return configured;
  return process.env.NODE_ENV === 'development' ? 'negaresh-test-2026' : undefined;
}

export function matchesBetaSecret(value: unknown, secret = getBetaSecret()): value is string {
  if (!secret || typeof value !== 'string' || value.length > 4096) return false;
  // Equal-size hashes avoid both length errors and prefix-dependent comparisons.
  return timingSafeEqual(createHash('sha256').update(value).digest(), createHash('sha256').update(secret).digest());
}
