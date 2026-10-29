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
  const out: Record<string, unknown> = {
    ok: me.status === 200,
    configured: true,
    user: me.status === 200 ? { id: me.data?.id, name: me.data?.name, slug: me.data?.slug, roles: me.data?.roles } : null,
    canEditCategories: !!(caps.manage_product_terms || caps.edit_product_terms || caps.manage_categories),
    ...(me.status !== 200 ? { error: `HTTP ${me.status}: ${me.error ?? ''}` } : {}),
  };
  if (me.status !== 200) {
    // which layer refuses: WordPress answers in JSON, a firewall/web server with an HTML page
    const probes: Record<string, unknown> = {};
    for (const [k, path] of [
      ['termEdit', `/wp-json/wp/v2/product_cat/${termId ?? 1}?context=edit`],
      ['wcCategory', `/wp-json/wc/v3/products/categories/${termId ?? 1}`],
      ['publicTerm', `/wp-json/wp/v2/product_cat/${termId ?? 1}`],
    ] as const) {
      const r = await wpGet<Record<string, unknown>>(path);
      probes[k] = { status: r.status, json: r.data !== null, error: r.error ? r.error.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160) : undefined };
    }
    out.probes = probes;
  }
  if (termId && me.status === 200) {
    const term = await wpGet<Record<string, unknown>>(`/wp-json/wp/v2/product_cat/${termId}?context=edit`);
    const d = term.data ?? {};
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
