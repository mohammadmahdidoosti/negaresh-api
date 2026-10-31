/**
 * Publishing one category's content to the store (theme carvansanat-theme, 2026-10):
 *   - «توضیح کوتاه» (term meta caravan_sanat_excerpt, plain text under the title)  ← the text above the product list
 *   - «توضیح» (term description, «درباره …» under the products)                   ← the guide, as HTML, with internal links
 *   - Rank Math title / description (rankmath/v1/updateMeta)                        ← SEO title and meta description
 * Every publish first stores what the category had (backup) so it can be put back with one call.
 * Nothing here runs by itself: only on the store owner's command, one category at a time.
 */
import { markdownToSafeHtml } from '@/lib/markdown-renderer';
import { applyLinks, planLinks, structuralLinks } from './links';
import type { ContentResult } from './pipeline';
import { storeBaseUrl } from './site';
import { kv } from './store';
import { getCategory } from './taxonomy';
import { wpGet, wpSend } from './wp';

export const EXCERPT_META = 'caravan_sanat_excerpt';

/** Markdown of the text above the list → plain text paragraphs (the field is plain text; the theme adds <p>). */
export function excerptText(md: string): string {
  return md
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .split(/\n\s*\n/)
    .map(p => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

/** The guide as store HTML: in-text links to other categories, plus a related-categories list at the end. */
export function descriptionHtml(result: ContentResult, opts: { links?: boolean; related?: boolean } = {}): { html: string; links: Array<{ anchor: string; url: string }> } {
  const planned = opts.links === false ? [] : planLinks(result.content.below, result.category.id, 5);
  let md = applyLinks(result.content.below, planned);
  if (opts.related !== false) {
    const s = structuralLinks(result.category.id, { children: 8, siblings: 4 });
    const items = [...s.children, ...s.siblings].filter(t => !planned.some(p => p.target.id === t.id));
    if (s.parent || items.length) {
      md += `\n\n### دسته‌های مرتبط\n\n${[...(s.parent ? [s.parent] : []), ...items].map(t => `- [${t.name}](${t.url})`).join('\n')}`;
    }
  }
  return { html: markdownToSafeHtml(md).trim(), links: planned.map(l => ({ anchor: l.anchor, url: l.target.url })) };
}

export interface PublishPayload {
  termId: number;
  termName: string;
  excerpt: string;
  description: string;
  rankMath: { rank_math_title: string; rank_math_description: string };
  links: Array<{ anchor: string; url: string }>;
}

async function findTermId(slug: string): Promise<{ id: number; name: string } | null> {
  const r = await wpGet<Array<{ id: number; name: string }>>(`/wp-json/wp/v2/product_cat?slug=${encodeURIComponent(slug)}&_fields=id,name`);
  return r.data?.[0] ?? null;
}

export async function buildPayload(result: ContentResult): Promise<PublishPayload> {
  const cat = getCategory(result.category.id);
  if (!cat) throw new Error('دسته در تاکسونومی نیست.');
  const term = await findTermId(cat.slug);
  if (!term) throw new Error('دسته در وردپرس پیدا نشد.');
  const desc = descriptionHtml(result);
  return {
    termId: term.id,
    termName: term.name,
    excerpt: excerptText(result.content.above),
    description: desc.html,
    rankMath: { rank_math_title: result.content.metaTitle, rank_math_description: result.content.metaDescription },
    links: desc.links,
  };
}

export interface CurrentState {
  description: string;
  excerpt: string | null; // null: the field is not readable through REST yet (theme change pending)
  pageTitle: string | null;
  pageDescription: string | null;
  excerptWritable: boolean;
}

/** What the category has now: term fields (edit context) and the live page's title/description. */
export async function currentState(termId: number, pageUrl?: string): Promise<CurrentState> {
  const t = await wpGet<{ description?: string; meta?: Record<string, unknown> }>(`/wp-json/wp/v2/product_cat/${termId}?context=edit`);
  if (t.status !== 200) throw new Error(`خواندن دسته از وردپرس ناموفق بود: ${t.error ?? t.status}`);
  const meta = t.data?.meta && !Array.isArray(t.data.meta) ? t.data.meta : {};
  const excerptWritable = EXCERPT_META in meta;
  let pageTitle: string | null = null;
  let pageDescription: string | null = null;
  if (pageUrl) {
    try {
      const html = await fetch(pageUrl, { headers: { 'User-Agent': 'NegareshContent/1.0' }, signal: AbortSignal.timeout(30_000) }).then(r => r.text());
      pageTitle = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
      pageDescription = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] ?? null;
    } catch {
      /* the live page is only informative */
    }
  }
  return {
    description: t.data?.description ?? '',
    excerpt: excerptWritable ? String(meta[EXCERPT_META] ?? '') : null,
    pageTitle,
    pageDescription,
    excerptWritable,
  };
}

interface Backup {
  at: string;
  termId: number;
  categoryId: string;
  resultId: string;
  before: CurrentState;
}

const backupKey = (categoryId: string) => `publish:backup:${categoryId}`;

export async function publishCategory(result: ContentResult, opts: { allowWithoutExcerpt?: boolean } = {}) {
  const client = await kv();
  if (!client) throw new Error('بدون Redis پشتیبان ذخیره نمی‌شود؛ انتشار انجام نشد.');
  const payload = await buildPayload(result);
  const pageUrl = result.category.url ?? undefined;
  const before = await currentState(payload.termId, pageUrl);
  if (!before.excerptWritable && !opts.allowWithoutExcerpt) {
    throw new Error('فیلد «توضیح کوتاه» هنوز از طریق اتصال قابل نوشتن نیست (تغییر register_term_meta در قالب). انتشار انجام نشد.');
  }
  // 1. backup first: nothing is written without it
  const backup: Backup = { at: new Date().toISOString(), termId: payload.termId, categoryId: result.category.id, resultId: result.resultId, before };
  await client.lPush(backupKey(result.category.id), JSON.stringify(backup));
  await client.lTrim(backupKey(result.category.id), 0, 9);
  // 2. term fields
  const body: Record<string, unknown> = { description: payload.description };
  if (before.excerptWritable) body.meta = { [EXCERPT_META]: payload.excerpt };
  const t = await wpSend<{ description?: string }>(`/wp-json/wp/v2/product_cat/${payload.termId}`, body);
  if (t.status !== 200) throw new Error(`نوشتن دسته ناموفق بود: ${t.error ?? t.status}`);
  // 3. Rank Math
  const rm = await wpSend<unknown>('/wp-json/rankmath/v1/updateMeta', { objectType: 'term', objectID: payload.termId, meta: payload.rankMath });
  // 4. verify
  const after = await currentState(payload.termId);
  const entry = {
    at: new Date().toISOString(),
    categoryId: result.category.id,
    name: result.category.name,
    termId: payload.termId,
    resultId: result.resultId,
    descriptionWritten: after.description.length > 0,
    excerptWritten: before.excerptWritable ? after.excerpt === payload.excerpt : false,
    rankMath: rm.status === 200 ? 'ok' : `HTTP ${rm.status}: ${rm.error ?? ''}`,
  };
  await client.lPush('publish:log', JSON.stringify(entry));
  await client.lTrim('publish:log', 0, 999);
  return { ...entry, links: payload.links };
}

/** Put back what the category had before the last publish (newest backup). */
export async function rollbackCategory(categoryId: string) {
  const client = await kv();
  if (!client) throw new Error('Redis در دسترس نیست.');
  const raw = await client.lIndex(backupKey(categoryId), 0);
  if (!raw) throw new Error('پشتیبانی برای این دسته نیست.');
  const b = JSON.parse(raw) as Backup;
  const body: Record<string, unknown> = { description: b.before.description };
  if (b.before.excerptWritable && b.before.excerpt !== null) body.meta = { [EXCERPT_META]: b.before.excerpt };
  const t = await wpSend<unknown>(`/wp-json/wp/v2/product_cat/${b.termId}`, body);
  if (t.status !== 200) throw new Error(`برگرداندن دسته ناموفق بود: ${t.error ?? t.status}`);
  // Rank Math: the category used the theme template before (no custom title) → empty values bring the template back
  const wasTemplate = !b.before.pageTitle || /^بایگانی/.test(b.before.pageTitle);
  const rm = await wpSend<unknown>('/wp-json/rankmath/v1/updateMeta', {
    objectType: 'term',
    objectID: b.termId,
    meta: wasTemplate ? { rank_math_title: '', rank_math_description: '' } : { rank_math_title: b.before.pageTitle ?? '', rank_math_description: b.before.pageDescription ?? '' },
  });
  await client.lPop(backupKey(categoryId));
  const entry = { at: new Date().toISOString(), categoryId, termId: b.termId, rollback: true, rankMath: rm.status === 200 ? 'ok' : `HTTP ${rm.status}` };
  await client.lPush('publish:log', JSON.stringify(entry));
  return entry;
}

export async function publishLog(limit = 50) {
  const client = await kv();
  if (!client) return [];
  return (await client.lRange('publish:log', 0, limit - 1)).map(x => JSON.parse(x));
}

export const storeUrl = storeBaseUrl;
