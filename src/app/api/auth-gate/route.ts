import { NextResponse } from 'next/server';
import { BETA_COOKIE, BETA_MAX_AGE, getBetaSecret, matchesBetaSecret } from '@/lib/beta-access';
import { readBoundedJson } from '@/lib/request-body';

export const runtime = 'nodejs';
type GateResponse = { success: true } | { success: false; error: string };

function failure(error: string, status: number): NextResponse<GateResponse> {
  return NextResponse.json({ success: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<NextResponse<GateResponse>> {
  const expected = getBetaSecret();
  if (!expected) return failure('ورود به نسخهٔ آزمایشی هنوز فعال نشده است.', 503);

  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch {
    return failure('درخواست نامعتبر است.', 400);
  }
  if (typeof body !== 'object' || body === null || !('secret' in body) || !matchesBetaSecret(body.secret, expected)) {
    return failure('رمز ورود نامعتبر است', 401);
  }

  const response = NextResponse.json<GateResponse>({ success: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(BETA_COOKIE, expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || new URL(request.url).protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: BETA_MAX_AGE,
  });
  return response;
}
