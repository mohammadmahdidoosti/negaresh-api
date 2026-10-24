import { NextResponse, type NextRequest } from 'next/server';
import { BETA_COOKIE, matchesBetaSecret } from './src/lib/beta-access';

const publicPaths = new Set([
  '/gate', '/api/auth-gate', '/favicon.ico', '/og.png',
  '/opengraph-image', '/how-it-works/opengraph-image',
]);

/** Called by src/proxy.ts, the Next.js 16 entry point beside src/app. */
export function middleware(request: NextRequest): NextResponse {
  const pathname = request.nextUrl.pathname.replace(/\/$/, '') || '/';
  // /api/v1/* authenticates with its own Bearer key (src/lib/api/auth.ts), not the beta cookie.
  if (pathname === '/api/v1' || pathname.startsWith('/api/v1/')) return NextResponse.next();
  if (publicPaths.has(pathname) || /^\/_next\/(?:static|image)(?:\/|$)/.test(pathname)) {
    return NextResponse.next();
  }
  if (matchesBetaSecret(request.cookies.get(BETA_COOKIE)?.value)) return NextResponse.next();

  // 303 prevents replaying a protected API POST body to the login page.
  const response = NextResponse.redirect(new URL('/gate', request.url), 303);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

// The dev server also discovers the requested root middleware entry.
export const config = { runtime: 'nodejs' };
