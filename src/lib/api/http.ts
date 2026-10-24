import { readBoundedJson, RequestBodyError } from '@/lib/request-body';
import { apiError } from './auth';
import { parseHumanizeBody, type PayloadResult } from './payload';

/** Read and validate the JSON body; returns either the payload or a ready error Response. */
export async function readPayload(request: Request): Promise<{ payload: Extract<PayloadResult, { ok: true }>['payload'] } | { response: Response }> {
  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch (error) {
    if (error instanceof RequestBodyError) {
      return { response: apiError(error.status, error.status === 413 ? 'body_too_large' : 'invalid_body', error.message) };
    }
    return { response: apiError(400, 'invalid_json', 'بدنهٔ درخواست JSON معتبر نیست.') };
  }
  const parsed = parseHumanizeBody(body);
  if (!parsed.ok) return { response: apiError(parsed.status, parsed.code, parsed.message) };
  return { payload: parsed.payload };
}

/** Public origin, honoring the reverse proxy headers set by hosts such as Render. */
export function publicOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host') || url.host;
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(':', '');
  return `${proto}://${host}`;
}
