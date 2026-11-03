/**
 * Blog posts → category pages (2026-11). Most of the site's search traffic lands on blog posts, which did not link
 * to the store. For a post: the first mention of a category name in its paragraphs and list items becomes a link
 * (longest names first, at most MAX_INLINE, never in headings, existing links or code), and a «related products»
 * box with the best-matching categories goes at the end (replaced, not repeated, on a later run).
 * The previous content is kept in Redis before every write.
 */
import { kv } from './store';
import { linkDictionary, type LinkTarget } from './links';
import { norm } from './taxonomy';
import { wpGet, wpSend } from './wp';

const MAX_INLINE = 4;
const MAX_BOX = 5;
const BOX_START = '<!-- negaresh:related -->';
const BOX_END = '<!-- /negaresh:related -->';
const LETTER = /[\p{L}\p{N}\u200c]/u; // a ZWNJ continues the word («شیر گازی‌ها»)

const flat = (s: string) => norm(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Categories whose names occur in the text, longest names first; the biggest category wins a shared name. */
export function matchCategories(text: string): LinkTarget[] {
  const t = ` ${flat(text)} `;
  const { byName, names } = linkDictionary();
  const out: LinkTarget[] = [];
  const taken: string[] = [];
  for (const n of names) {
    if (!t.includes(` ${n} `)) continue;
    if (taken.some(x => x.includes(n))) continue; // «زانو» inside an already matched «زانو پلی اتیلن»
    const best = [...byName.get(n)!].sort((a, b) => b.products - a.products)[0];
    if (out.some(o => o.id === best.id)) continue;
    out.push(best);
    taken.push(n);
  }
  return out;
}

/** Escape for a RegExp, with any run of spaces/ZWNJ/hyphens matching any other. */
const pattern = (name: string) =>
  name
    .trim()
    .split(/[\s‌\-]+/)
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s‌\\-]+');

/** Add in-text links to an HTML post body (text inside <p>/<li> only). */
export function linkHtml(html: string, targets: LinkTarget[], max = MAX_INLINE): { html: string; linked: LinkTarget[] } {
  const parts = html.split(/(<[^>]+>)/);
  const linked: LinkTarget[] = [];
  let inA = 0;
  let skip = 0; // headings, code, pre, script, style, figcaption, table header
  let inText = 0; // inside p or li
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith('<')) {
      const m = p.match(/^<\s*(\/)?\s*([a-z0-9]+)/i);
      if (!m) continue;
      const close = !!m[1];
      const tag = m[2].toLowerCase();
      const d = close ? -1 : p.endsWith('/>') ? 0 : 1;
      if (tag === 'a') inA = Math.max(0, inA + d);
      else if (/^(h[1-6]|code|pre|script|style|figcaption|th|button)$/.test(tag)) skip = Math.max(0, skip + d);
      else if (tag === 'p' || tag === 'li') inText = Math.max(0, inText + d);
      continue;
    }
    if (inA || skip || !inText || !p.trim() || linked.length >= max) continue;
    for (const t of targets) {
      if (linked.length >= max || linked.some(l => l.id === t.id)) continue;
      const re = new RegExp(pattern(t.name), 'u');
      const m = re.exec(parts[i]);
      if (!m) continue;
      const before = parts[i][m.index - 1];
      const after = parts[i][m.index + m[0].length];
      if ((before && LETTER.test(before)) || (after && LETTER.test(after))) continue;
      parts[i] = `${parts[i].slice(0, m.index)}<a href="${t.url}">${m[0]}</a>${parts[i].slice(m.index + m[0].length)}`;
      linked.push(t);
      break; // one link per text piece
    }
  }
  return { html: parts.join(''), linked };
}

export function relatedBox(targets: LinkTarget[]): string {
  if (!targets.length) return '';
  const items = targets.map(t => `<li><a href="${t.url}">${t.name}</a></li>`).join('');
  return `${BOX_START}\n<!-- wp:html -->\n<div class="cs-related-products"><h3>محصولات مرتبط در کاروان صنعت</h3><ul>${items}</ul></div>\n<!-- /wp:html -->\n${BOX_END}`;
}

export function stripBox(html: string): string {
  const a = html.indexOf(BOX_START);
  const b = html.indexOf(BOX_END);
  return a >= 0 && b > a ? (html.slice(0, a) + html.slice(b + BOX_END.length)).trimEnd() : html;
}

/** New body for a post: in-text links (to categories not yet linked from it) and the related box. */
export function linkPost(raw: string, title: string): { html: string; inline: LinkTarget[]; box: LinkTarget[] } {
  const body = stripBox(raw);
  const plain = body.replace(/<[^>]+>/g, ' ');
  const already = new Set([...body.matchAll(/href="([^"]+)"/g)].map(m => decodeURIComponent(m[1])));
  const inTitle = matchCategories(title);
  const all = [...inTitle, ...matchCategories(plain).filter(t => !inTitle.some(x => x.id === t.id))].filter(t => !already.has(decodeURIComponent(t.url)) && !already.has(t.url));
  const { html, linked } = linkHtml(body, all);
  const box = [...inTitle, ...all].filter((t, i, a) => a.findIndex(x => x.id === t.id) === i).slice(0, MAX_BOX);
  return { html: box.length ? `${html}\n\n${relatedBox(box)}` : html, inline: linked, box };
}

export async function linkBlogPost(postId: number, opts: { dry?: boolean } = {}) {
  const r = await wpGet<{ id: number; title: { raw: string }; content: { raw: string }; link: string }>(`/wp-json/wp/v2/posts/${postId}?context=edit&_fields=id,title,content,link`);
  if (r.status !== 200 || !r.data) throw new Error(`خواندن نوشته ناموفق بود (${r.status}): ${r.error ?? ''}`);
  const raw = r.data.content.raw;
  const out = linkPost(raw, r.data.title.raw);
  const result = { postId, link: r.data.link, inline: out.inline.map(t => t.name), box: out.box.map(t => t.name), changed: out.html !== raw };
  if (opts.dry || !result.changed) return result;
  const client = await kv();
  if (!client) throw new Error('بدون Redis پشتیبان ذخیره نمی‌شود.');
  await client.lPush(`blog:backup:${postId}`, JSON.stringify({ at: new Date().toISOString(), content: raw }));
  await client.lTrim(`blog:backup:${postId}`, 0, 4);
  const w = await wpSend(`/wp-json/wp/v2/posts/${postId}`, { content: out.html });
  if (w.status !== 200) throw new Error(`نوشتن نوشته ناموفق بود (${w.status}): ${w.error ?? ''}`);
  return result;
}

export async function rollbackBlogPost(postId: number) {
  const client = await kv();
  const raw = client ? await client.lIndex(`blog:backup:${postId}`, 0) : null;
  if (!raw) throw new Error('پشتیبانی برای این نوشته نیست.');
  const b = JSON.parse(raw) as { content: string };
  const w = await wpSend(`/wp-json/wp/v2/posts/${postId}`, { content: b.content });
  if (w.status !== 200) throw new Error(`برگرداندن ناموفق بود (${w.status})`);
  await client!.lPop(`blog:backup:${postId}`);
  return { postId, restored: true };
}
