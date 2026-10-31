/**
 * Category images (2026-10): level-1 categories get a drawn icon (data/icons/l1/<taxonomy id>.webp), uploaded to the
 * media library and set as the category image through WooCommerce REST. Every change first records what the category
 * had, so it can be put back. Runs only on the store owner's command.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { storeBaseUrl } from './site';
import { kv } from './store';
import { getCategory } from './taxonomy';
import { wpGet, wpSend } from './wp';

const DATA_DIR = process.env.CONTENT_DATA_DIR || join(process.cwd(), 'data');
export const iconPath = (taxonomyId: string) => join(DATA_DIR, 'icons', 'l1', `${taxonomyId}.webp`);

function authHeader(): string {
  const user = process.env.WP_USER?.trim() ?? '';
  const pass = (process.env.WP_APP_PASSWORD ?? '').replace(/\s+/g, '');
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

/** Upload one file to the media library; returns the attachment id. */
export async function wpUploadMedia(file: Buffer, filename: string, mime: string, alt: string): Promise<number> {
  const res = await fetch(`${storeBaseUrl()}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${filename}"`,
      Accept: 'application/json',
      'User-Agent': 'NegareshContent/1.0 (+https://negaresh.caravansanat.com)',
    },
    body: new Uint8Array(file),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  let data: { id?: number; message?: string } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* firewall page */
  }
  if (!res.ok || !data?.id) throw new Error(`آپلود ناموفق (${res.status}): ${data?.message ?? text.slice(0, 160)}`);
  await wpSend(`/wp-json/wp/v2/media/${data.id}`, { alt_text: alt, title: alt });
  return data.id;
}

async function termBySlug(slug: string): Promise<{ id: number; name: string } | null> {
  const r = await wpGet<Array<{ id: number; name: string }>>(`/wp-json/wp/v2/product_cat?slug=${encodeURIComponent(slug)}&_fields=id,name`);
  return r.data?.[0] ?? null;
}

async function currentImage(termId: number): Promise<{ id: number; src: string } | null> {
  const r = await wpGet<{ image?: { id: number; src: string } | null }>(`/wp-json/wc/v3/products/categories/${termId}`);
  if (r.status !== 200) throw new Error(`خواندن تصویر دسته ناموفق بود (${r.status}): ${r.error ?? ''}`);
  return r.data?.image ? { id: r.data.image.id, src: r.data.image.src } : null;
}

async function setImage(termId: number, mediaId: number | null) {
  const r = await wpSend<{ image?: { id: number } | null }>(`/wp-json/wc/v3/products/categories/${termId}`, { image: mediaId ? { id: mediaId } : null });
  if (r.status !== 200) throw new Error(`تنظیم تصویر دسته ناموفق بود (${r.status}): ${r.error ?? ''}`);
  return r.data?.image?.id ?? null;
}

export interface IconResult {
  taxonomyId: string;
  name: string;
  termId?: number;
  mediaId?: number;
  before?: number | null;
  ok: boolean;
  skipped?: string;
  error?: string;
}

/** Upload and set the drawn icon of each level-1 category (all, or the given taxonomy ids). Keeps an existing image unless replace. */
export async function applyLevel1Icons(opts: { only?: string[]; replace?: boolean } = {}): Promise<IconResult[]> {
  const client = await kv();
  if (!client) throw new Error('بدون Redis پشتیبان ذخیره نمی‌شود؛ کاری انجام نشد.');
  const out: IconResult[] = [];
  const ids = opts.only?.length ? opts.only : [];
  if (!ids.length) {
    for (let i = 0; i < 20000; i++) {
      const c = getCategory(String(i));
      if (c && !c.parent && existsSync(iconPath(c.id))) ids.push(c.id);
    }
  }
  for (const id of ids) {
    const cat = getCategory(id);
    if (!cat) {
      out.push({ taxonomyId: id, name: '?', ok: false, error: 'دسته در تاکسونومی نیست' });
      continue;
    }
    const base: IconResult = { taxonomyId: id, name: cat.name, ok: false };
    try {
      if (!existsSync(iconPath(id))) throw new Error('فایل آیکون نیست');
      const term = await termBySlug(cat.slug);
      if (!term) {
        out.push({ ...base, skipped: 'دسته در وردپرس پیدا نشد' });
        continue;
      }
      const before = await currentImage(term.id);
      if (before && !opts.replace) {
        out.push({ ...base, termId: term.id, before: before.id, skipped: 'تصویر دارد' });
        continue;
      }
      await client.lPush(`image:backup:${term.id}`, JSON.stringify({ at: new Date().toISOString(), before: before?.id ?? null }));
      const mediaId = await wpUploadMedia(readFileSync(iconPath(id)), `category-icon-${id}.webp`, 'image/webp', cat.name);
      const set = await setImage(term.id, mediaId);
      const entry = { ...base, termId: term.id, mediaId, before: before?.id ?? null, ok: set === mediaId };
      await client.lPush('image:log', JSON.stringify({ at: new Date().toISOString(), ...entry }));
      out.push(entry);
    } catch (error) {
      out.push({ ...base, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}

/** Put back the image a category had before the last change (the uploaded file stays in the media library). */
export async function rollbackImage(termId: number) {
  const client = await kv();
  if (!client) throw new Error('Redis در دسترس نیست.');
  const raw = await client.lIndex(`image:backup:${termId}`, 0);
  if (!raw) throw new Error('پشتیبانی برای این دسته نیست.');
  const b = JSON.parse(raw) as { before: number | null };
  await setImage(termId, b.before);
  await client.lPop(`image:backup:${termId}`);
  return { termId, restored: b.before };
}
