/**
 * WordPress (WooCommerce store) access with an Application Password: WP_USER + WP_APP_PASSWORD (Coolify env).
 * This module only reads. Publishing is a separate, explicit step on the store owner's command.
 */
import { storeBaseUrl } from './site';

export function wpConfigured(): boolean {
  return !!process.env.WP_USER?.trim() && !!process.env.WP_APP_PASSWORD?.trim();
}

function authHeader(): string {
  const user = process.env.WP_USER?.trim() ?? '';
  const pass = (process.env.WP_APP_PASSWORD ?? '').replace(/\s+/g, '');
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

export async function wpGet<T>(path: string, signal?: AbortSignal): Promise<{ status: number; data: T | null; error?: string }> {
  const timeout = AbortSignal.timeout(30_000);
  try {
    const res = await fetch(`${storeBaseUrl()}${path}`, {
      headers: { Authorization: authHeader(), Accept: 'application/json', 'User-Agent': 'NegareshContent/1.0 (+https://negaresh.caravansanat.com)' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const text = await res.text();
    let data: T | null = null;
    try {
      data = JSON.parse(text) as T;
    } catch {
      /* not JSON (e.g. a firewall page) */
    }
    return { status: res.status, data, ...(res.ok ? {} : { error: (data as { message?: string } | null)?.message ?? text.slice(0, 200) }) };
  } catch (error) {
    return { status: 0, data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Read-only connection check: who we are, what we may do, and what one category looks like in edit context. */
export async function wpCheck(termId?: number) {
  if (!wpConfigured()) return { ok: false, configured: false, error: 'WP_USER / WP_APP_PASSWORD تنظیم نشده‌اند.' };
  const me = await wpGet<{ id: number; name: string; slug: string; roles?: string[]; capabilities?: Record<string, boolean> }>('/wp-json/wp/v2/users/me?context=edit');
  const caps = me.data?.capabilities ?? {};
  // shape only, never the values: helps tell a wrong user from a mangled password
  const rawUser = process.env.WP_USER ?? '';
  const rawPass = process.env.WP_APP_PASSWORD ?? '';
  const bare = rawPass.replace(/\s+/g, '');
  const shape = {
    userIsEmail: /@/.test(rawUser),
    userHasOuterSpaceOrQuotes: rawUser !== rawUser.trim() || /^["']|["']$/.test(rawUser.trim()),
    passwordLength: bare.length,
    passwordLooksLikeAppPassword: /^[A-Za-z0-9]{24}$/.test(bare),
    passwordHasQuotes: /["']/.test(rawPass),
    passwordGroups: rawPass.trim().split(/\s+/).length,
  };
  // the site firewall blocks /users/me (403 HTML page); a category read in edit context proves the password instead
  const probe = await wpGet<Record<string, unknown>>(`/wp-json/wp/v2/product_cat/${termId ?? 1}?context=edit`);
  const authed = probe.status === 200;
  const out: Record<string, unknown> = {
    ok: me.status === 200 || authed,
    authenticated: authed,
    configured: true,
    shape,
    user: me.status === 200 ? { id: me.data?.id, name: me.data?.name, slug: me.data?.slug, roles: me.data?.roles } : null,
    canEditCategories: !!(caps.manage_product_terms || caps.edit_product_terms || caps.manage_categories),
    ...(me.status !== 200 ? { error: `HTTP ${me.status}: ${me.error ?? ''}` } : {}),
  };
  if (!authed) {
    // which layer refuses: WordPress answers in JSON, a firewall/web server with an HTML page
    const probes: Record<string, unknown> = {};
    for (const [k, path] of [
      ['termEdit', `/wp-json/wp/v2/product_cat/${termId ?? 1}?context=edit`],
      ['wcCategory', `/wp-json/wc/v3/products/categories/${termId ?? 1}`],
      ['publicTerm', `/wp-json/wp/v2/product_cat/${termId ?? 1}`],
    ] as const) {
      const r = await wpGet<Record<string, unknown>>(path);
      probes[k] = { status: r.status, json: r.data !== null, code: (r.data as { code?: string } | null)?.code, error: r.error ? r.error.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160) : undefined };
    }
    out.probes = probes;
  }
  if (termId && authed) {
    const term = probe;
    const d = term.data ?? {};
    const wc = await wpGet<Record<string, unknown>>(`/wp-json/wc/v3/products/categories/${termId}`);
    out.wcCategoryKeys = wc.data ? Object.keys(wc.data) : [];
    out.term = {
      status: term.status,
      id: d.id,
      name: d.name,
      descriptionLength: typeof d.description === 'string' ? d.description.length : null,
      // which term meta the REST API exposes (Woodmart / Rank Math keys are not registered by default)
      metaKeys: d.meta && typeof d.meta === 'object' ? Object.keys(d.meta as object) : [],
    };
  }
  return out;
}
