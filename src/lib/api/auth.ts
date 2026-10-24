// Server-only: Bearer-token authentication for the public /api/v1 endpoints.
import { createHash, timingSafeEqual } from 'node:crypto';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** NEGARESH_API_KEY may hold one key or several comma-separated keys. */
export function configuredApiKeys(): string[] {
  return (process.env.NEGARESH_API_KEY ?? '')
    .split(',')
    .map(key => key.trim())
    .filter(Boolean);
}

function presentedKey(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) return match[1].trim();
  }
  const alt = request.headers.get('x-api-key');
  return alt?.trim() || null;
}

export function apiError(status: number, code: string, message: string, headers?: Record<string, string>): Response {
  return Response.json(
    { ok: false, error: { code, message } },
    { status, headers: { 'Cache-Control': 'no-store', ...headers } },
  );
}

/** Returns an error Response when the caller is not authorized, otherwise null. */
export function requireApiKey(request: Request): Response | null {
  const keys = configuredApiKeys();
  if (keys.length === 0) {
    return apiError(503, 'api_disabled', 'API فعال نیست: متغیر NEGARESH_API_KEY روی سرور تنظیم نشده است.');
  }
  const key = presentedKey(request);
  if (!key || key.length > 4096) {
    return apiError(401, 'unauthorized', 'کلید API ارسال نشده است. هدر Authorization: Bearer <key> را بفرستید.', {
      'WWW-Authenticate': 'Bearer',
    });
  }
  const presented = digest(key);
  // Compare against every key so timing does not reveal which one matched.
  let matched = false;
  for (const candidate of keys) {
    if (timingSafeEqual(presented, digest(candidate))) matched = true;
  }
  if (!matched) {
    return apiError(401, 'unauthorized', 'کلید API نامعتبر است.', { 'WWW-Authenticate': 'Bearer' });
  }
  return null;
}
