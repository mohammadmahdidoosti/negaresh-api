/**
 * Blog consolidation and strengthening (2026-11). Nothing here publishes: every result is saved in WordPress as a
 * DRAFT post for the owner to read. Publishing a consolidated guide (into the URL of the strongest post) and the
 * redirects of the others happen only after the owner approves the draft.
 *
 * - clusters(): posts grouped by the category their title is about (many short posts on one topic compete in
 *   Google and none ranks).
 * - consolidate(postIds): one comprehensive guide from the group's posts.
 * - strengthen(postId): the same post with a summary table, real-search FAQ and product links added, nothing removed.
 */
import { markdownToSafeHtml } from '@/lib/markdown-renderer';
import { createExecutionContext, generateText } from '@/lib/humanizer';
import { linkPost, matchCategories } from './blog';
import { DEFAULT_DRAFT_MODEL } from './pipeline';
import { wpGet, wpSend } from './wp';

interface WpPost {
  id: number;
  title: { rendered?: string; raw?: string };
  content: { raw?: string; rendered?: string };
  link: string;
  date?: string;
}

const strip = (html: string) =>
  html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
const words = (s: string) => s.split(/\s+/).filter(Boolean);
const cap = (s: string, n: number) => words(s).slice(0, n).join(' ');
const decodeTitle = (s: string) => s.replace(/&#8211;/g, '–').replace(/&amp;/g, '&').replace(/&#[0-9]+;/g, ' ');

async function allPosts(): Promise<Array<{ id: number; title: string; link: string }>> {
  const out: Array<{ id: number; title: string; link: string }> = [];
  for (let page = 1; page <= 30; page++) {
    const r = await wpGet<WpPost[]>(`/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=id,title,link`);
    if (r.status !== 200 || !Array.isArray(r.data)) break;
    out.push(...r.data.map(p => ({ id: p.id, title: decodeTitle(p.title.rendered ?? ''), link: decodeURI(p.link) })));
    if (r.data.length < 100) break;
  }
  return out;
}

/** Posts grouped by the (longest) category name in their title; groups of 3+ are consolidation candidates. */
export async function clusters(min = 3) {
  const posts = await allPosts();
  const byTopic = new Map<string, typeof posts>();
  for (const p of posts) {
    const topic = matchCategories(p.title).sort((a, b) => b.name.length - a.name.length)[0]?.name;
    if (!topic) continue;
    byTopic.set(topic, [...(byTopic.get(topic) ?? []), p]);
  }
  return [...byTopic.entries()]
    .filter(([, list]) => list.length >= min)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([topic, list]) => ({ topic, count: list.length, posts: list }));
}

async function getPost(id: number): Promise<WpPost> {
  const r = await wpGet<WpPost>(`/wp-json/wp/v2/posts/${id}?context=edit&_fields=id,title,content,link,date`);
  if (r.status !== 200 || !r.data) throw new Error(`خواندن نوشتهٔ ${id} ناموفق بود (${r.status})`);
  return r.data;
}

const SYSTEM = `تو نویسندهٔ فنی بلاگ فروشگاه «کاروان صنعت» (تجهیزات تأسیسات، صنعتی و کشاورزی) هستی و فارسی روان و دقیق با نیم‌فاصلهٔ درست می‌نویسی.
قواعد:
- فقط از مطالبی که در متن‌های داده‌شده هست استفاده کن. عدد، استاندارد، برند یا ادعای تازه نساز. اگر دو متن با هم تناقض دارند، نسخهٔ محتاطانه‌تر را بنویس.
- قیمت، تخفیف، «بهترین»، «تضمین» و ادعای مطلق ممنوع.
- خروجی فقط Markdown: یک تیتر # در اول، بخش‌ها با ##، زیربخش‌ها با ###، جدول Markdown اگر مقایسه یا مشخصات هست، و در آخر «## سؤالات متداول» با ۴ تا ۶ سؤال کوتاه (### سؤال و پاسخ ۲ تا ۳ جمله‌ای).
- مقدمه ۲ تا ۳ جمله و بلافاصله جواب اصلی سؤال کاربر را بده. پاراگراف‌ها کوتاه.
- بخش «نتیجه‌گیری» ننویس.`;

/** One comprehensive guide from a group of overlapping posts, saved as a WordPress draft. */
export async function consolidate(postIds: number[], opts: { title?: string } = {}) {
  if (postIds.length < 2) throw new Error('حداقل دو نوشته لازم است.');
  const posts = await Promise.all(postIds.map(getPost));
  const sources = posts.map((p, i) => `### متن ${i + 1}: ${decodeTitle(p.title.raw ?? p.title.rendered ?? '')}\n${cap(strip(p.content.raw ?? ''), 1500)}`).join('\n\n');
  const topic = opts.title ?? decodeTitle(posts[0].title.raw ?? '');
  const md = await generateText(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `این ${posts.length} نوشته دربارهٔ یک موضوع‌اند و در گوگل با هم رقابت می‌کنند. همه را در یک راهنمای جامع و بی‌تکرار ادغام کن که همهٔ سؤال‌های این نوشته‌ها (چیست، طرز کار، اجزا، نصب، سیم‌کشی، تنظیم، عیب‌یابی، تعمیر، …) را در بخش‌های جدا پوشش دهد. عنوان پیشنهادی: «${topic}».\n\n${sources}`,
      },
    ],
    { model: DEFAULT_DRAFT_MODEL(), maxTokens: 14000, temperature: 0.4, stage: 'content-draft', useFallback: false },
    createExecutionContext(),
  );
  return saveDraft(md, posts.map(p => p.id), 'consolidate');
}

/** The same post with a table, FAQ and product links added; the original text stays. Saved as a draft copy. */
export async function strengthen(postId: number, searches: string[] = []) {
  const p = await getPost(postId);
  const text = cap(strip(p.content.raw ?? ''), 3500);
  const md = await generateText(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `این نوشته در گوگل رتبه دارد؛ بازنویسی‌اش نکن. همان متن را با همان تیترها نگه دار و فقط بهترش کن: (۱) اگر جای مقایسه یا مشخصات هست یک جدول خلاصه اضافه کن، (۲) جمله‌های تکراری یا مبهم را دقیق کن، (۳) در آخر «## سؤالات متداول» بگذار${searches.length ? ` و این جست‌وجوهای واقعی را اگر متن جوابشان را دارد پوشش بده: ${searches.join('، ')}` : ''}. چیزی از اطلاعات متن حذف نکن.\n\nعنوان: ${decodeTitle(p.title.raw ?? '')}\n\n${text}`,
      },
    ],
    { model: DEFAULT_DRAFT_MODEL(), maxTokens: 14000, temperature: 0.3, stage: 'content-draft', useFallback: false },
    createExecutionContext(),
  );
  return saveDraft(md, [p.id], 'strengthen');
}

async function saveDraft(md: string, sourceIds: number[], kind: 'consolidate' | 'strengthen') {
  const title = (md.match(/^#\s+(.+)$/m)?.[1] ?? 'پیش‌نویس').trim();
  const body = md.replace(/^#\s+.+$/m, '').trim();
  const linked = linkPost(markdownToSafeHtml(body), title);
  const note = `<!-- negaresh:draft kind=${kind} sources=${sourceIds.join(',')} -->`;
  const label = kind === 'consolidate' ? 'ادغام' : 'تقویت';
  const r = await wpSend<{ id: number; link: string }>('/wp-json/wp/v2/posts', { title: `[پیش‌نویس ${label}] ${title}`, content: `${note}\n${linked.html}`, status: 'draft' });
  if ((r.status !== 201 && r.status !== 200) || !r.data?.id) throw new Error(`ذخیرهٔ پیش‌نویس ناموفق بود (${r.status}): ${r.error ?? ''}`);
  return { draftId: r.data.id, title, sources: sourceIds, words: words(body).length, links: linked.inline.map(t => t.name), box: linked.box.map(t => t.name) };
}
