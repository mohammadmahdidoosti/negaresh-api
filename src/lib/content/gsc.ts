/**
 * Google Search Console (read-only) with a service account: GSC_SERVICE_ACCOUNT holds the JSON key of
 * negaresh-gsc@negaresh-seo.iam.gserviceaccount.com, which has «Restricted» access to sc-domain:caravansanat.com.
 * Used to see what each category page is found for (queries, clicks, impressions, CTR, position).
 */
import { createSign } from 'node:crypto';
import { kv } from './store';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const gscSite = () => process.env.GSC_SITE?.trim() || 'sc-domain:caravansanat.com';

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export function gscConfigured(): boolean {
  return !!process.env.GSC_SERVICE_ACCOUNT?.trim();
}

function account(): ServiceAccount {
  const raw = process.env.GSC_SERVICE_ACCOUNT?.trim();
  if (!raw) throw new Error('GSC_SERVICE_ACCOUNT تنظیم نشده است.');
  const sa = JSON.parse(raw) as ServiceAccount;
  if (!sa.client_email || !sa.private_key) throw new Error('GSC_SERVICE_ACCOUNT کلید معتبر حساب سرویس نیست.');
  return sa;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

const day = (d: Date) => d.toISOString().slice(0, 10);

let token: { value: string; exp: number } | undefined;

async function accessToken(): Promise<string> {
  if (token && token.exp - 60 > Date.now() / 1000) return token.value;
  const sa = account();
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${head}.${claim}`);
  const jwt = `${head}.${claim}.${b64url(signer.sign(sa.private_key))}`;
  const res = await fetch(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
  if (!res.ok || !data.access_token) throw new Error(`توکن گوگل گرفته نشد: ${data.error_description ?? data.error ?? res.status}`);
  token = { value: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return token.value;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Search Console: ${data.error?.message ?? res.status}`);
  return data;
}

/** Top pages by impressions (last 28 days) whose URL contains `contains` — to see how the site's URLs look. */
export async function topPages(contains = '/product-category/', limit = 20) {
  const end = new Date(Date.now() - 3 * 86400_000);
  const start = new Date(end.getTime() - 28 * 86400_000);
  const data = await api<{ rows?: Array<{ keys: string[]; clicks: number; impressions: number; position: number }> }>(
    `/sites/${encodeURIComponent(gscSite())}/searchAnalytics/query`,
    { startDate: day(start), endDate: day(end), dimensions: ['page'], dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'contains', expression: contains }] }], rowLimit: limit },
  );
  return (data.rows ?? []).map(r => ({ page: decodeURI(r.keys[0]), clicks: r.clicks, impressions: r.impressions, position: Number(r.position.toFixed(1)) }));
}

export async function gscCheck() {
  if (!gscConfigured()) return { ok: false, configured: false, error: 'GSC_SERVICE_ACCOUNT تنظیم نشده است.' };
  try {
    const sites = await api<{ siteEntry?: Array<{ siteUrl: string; permissionLevel: string }> }>('/sites');
    return { ok: true, configured: true, account: account().client_email, sites: sites.siteEntry ?? [], site: gscSite() };
  } catch (error) {
    return { ok: false, configured: true, error: error instanceof Error ? error.message : String(error) };
  }
}

export interface GscRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/**
 * Queries a page is found for, last `days` days (Search Console data lags ~3 days). Cached a day per page.
 * The page is matched by URL prefix, so «/product-category/زانو/page/2/» counts with the page.
 */
export async function pageQueries(pageUrl: string, days = 90): Promise<{ rows: GscRow[]; totals: { clicks: number; impressions: number }; from: string; to: string }> {
  const client = await kv();
  const key = `gsc:page:${days}:${pageUrl}`;
  const hit = client ? await client.get(key).catch(() => null) : null;
  if (hit) return JSON.parse(hit);
  const end = new Date(Date.now() - 3 * 86400_000);
  const start = new Date(end.getTime() - days * 86400_000);
  const data = await api<{ rows?: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }> }>(
    `/sites/${encodeURIComponent(gscSite())}/searchAnalytics/query`,
    {
      startDate: day(start),
      endDate: day(end),
      dimensions: ['query'],
      // Search Console stores Persian URLs percent-encoded; match the encoded path
      dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'contains', expression: encodeURI(decodeURI(pageUrl).replace(/^https?:\/\/[^/]+/, '')) }] }],
      rowLimit: 1000,
    },
  );
  const rows = (data.rows ?? []).map(r => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: Number(r.ctr.toFixed(4)), position: Number(r.position.toFixed(1)) }));
  const out = {
    rows,
    totals: { clicks: rows.reduce((n, r) => n + r.clicks, 0), impressions: rows.reduce((n, r) => n + r.impressions, 0) },
    from: day(start),
    to: day(end),
  };
  if (client) await client.set(key, JSON.stringify(out), { EX: 86400 }).catch(() => undefined);
  return out;
}
