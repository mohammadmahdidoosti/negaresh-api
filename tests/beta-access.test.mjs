import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { tryNative: false, alias: { '@': new URL('../src', import.meta.url).pathname } });
const { NextRequest } = await jiti.import('next/server');
const { middleware } = await jiti.import('../middleware.ts');
const { POST } = await jiti.import('../src/app/api/auth-gate/route.ts');
const { getBetaSecret } = await jiti.import('../src/lib/beta-access.ts');

function request(path, value, method = 'GET') {
  return new NextRequest(`https://negaresh.test${path}`, { method, headers: value === undefined ? {} : { cookie: `beta_access=${value}` } });
}
function login(body) {
  return POST(new Request('https://negaresh.test/api/auth-gate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
}

test('beta gate: protected pages and API, exact exemptions, validation and cookie security', async () => {
  const originalSecret = process.env.BETA_ACCESS_SECRET;
  const originalMode = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    process.env.BETA_ACCESS_SECRET = 'private-test-secret';
    for (const path of ['/', '/how-it-works', '/api/humanize', '/api/auth-gate-extra', '/gate-extra', '/api/humanize/opengraph-image']) {
      for (const value of [undefined, 'wrong', 'negaresh-test-2026']) {
        const response = middleware(request(path, value, path.startsWith('/api') ? 'POST' : 'GET'));
        assert.equal(response.status, 303, path);
        assert.equal(response.headers.get('location'), 'https://negaresh.test/gate');
        assert.match(response.headers.get('cache-control'), /no-store/);
      }
      assert.equal(middleware(request(path, 'private-test-secret')).headers.get('x-middleware-next'), '1');
    }
    for (const path of ['/gate', '/gate/', '/api/auth-gate', '/favicon.ico', '/og.png', '/opengraph-image', '/how-it-works/opengraph-image', '/_next/static/chunk.js', '/_next/image?url=x']) {
      assert.equal(middleware(request(path)).headers.get('x-middleware-next'), '1', path);
    }
    for (const body of [{ secret: 'wrong' }, { secret: 123 }, {}, null]) {
      const response = await login(JSON.stringify(body));
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { success: false, error: 'رمز ورود نامعتبر است' });
      assert.equal(response.headers.get('set-cookie'), null);
    }
    assert.equal((await login('{')).status, 400);
    const response = await login(JSON.stringify({ secret: 'private-test-secret' }));
    assert.deepEqual(await response.json(), { success: true });
    const cookie = response.headers.get('set-cookie');
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=lax', 'Path=/', 'Max-Age=2592000']) assert.ok(cookie.includes(flag), flag);
    assert.match(response.headers.get('cache-control'), /no-store/);
    // Rotating the deployment secret invalidates previously issued cookies.
    process.env.BETA_ACCESS_SECRET = 'rotated-secret';
    assert.equal(middleware(request('/', 'private-test-secret')).status, 303);
    delete process.env.BETA_ACCESS_SECRET;
    assert.equal(getBetaSecret(), undefined);
    assert.equal((await login(JSON.stringify({ secret: 'negaresh-test-2026' }))).status, 503);
    assert.equal(middleware(request('/', 'negaresh-test-2026')).status, 303);
    process.env.NODE_ENV = 'development';
    assert.equal(getBetaSecret(), 'negaresh-test-2026');
    assert.equal((await login(JSON.stringify({ secret: 'negaresh-test-2026' }))).status, 200);
  } finally {
    if (originalSecret === undefined) delete process.env.BETA_ACCESS_SECRET; else process.env.BETA_ACCESS_SECRET = originalSecret;
    if (originalMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalMode;
  }
});
