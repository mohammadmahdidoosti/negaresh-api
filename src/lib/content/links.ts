/**
 * Internal links between category pages.
 *
 * - In-text links: the first mention of another category's name in a page's guide links to that category.
 *   Longest names first («زانو پلی اتیلن» before «زانو»), at most a few per page, never to the page itself,
 *   never inside headings, tables or existing links. When a name belongs to several categories (duplicates in the
 *   store), the one in the same main group with the most products wins.
 * - Structural links: parent, main subcategories and nearest siblings, for a «related categories» block.
 *
 * Links are added when a page is published, not stored in the text, so a later link pass can update old pages
 * as new categories are published.
 */
import { storeBaseUrl } from './site';
import { ancestors, childrenOf, getCategory, norm, searchCategories, siblingsOf, type Category } from './taxonomy';

export interface LinkTarget {
  id: string;
  name: string;
  url: string;
  products: number;
  l1: string;
}

export interface PlannedLink {
  anchor: string;
  target: LinkTarget;
  line: number;
}

/** Category names too generic to link on their own (they appear in many unrelated sentences). */
const GENERIC = new Set(['لوازم', 'قطعات', 'اتصالات', 'متفرقه', 'سایر', 'لوازم جانبی', 'ابزار', 'تجهیزات', 'محصولات']);

export function categoryUrl(cat: Category): string {
  return `${storeBaseUrl()}/product-category/${encodeURI(cat.slug)}/`;
}

const flat = (s: string) => norm(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

let cache: { at: number; byName: Map<string, LinkTarget[]>; names: string[] } | undefined;

/** Name → candidate categories, for every category that has products. */
export function linkDictionary() {
  if (cache && Date.now() - cache.at < 3600_000) return cache;
  const byName = new Map<string, LinkTarget[]>();
  for (const c of searchCategories('', { hasProducts: true, limit: 100_000 })) {
    const key = flat(c.name);
    if (key.length < 4 || GENERIC.has(key)) continue;
    // a one-word name («کلید»، «پمپ») is an everyday word in this trade; link it only to a big category
    if (!key.includes(' ') && c.products < 100) continue;
    const l1 = ancestors(c)[0]?.id ?? c.id;
    byName.set(key, [...(byName.get(key) ?? []), { id: c.id, name: c.name, url: categoryUrl(c), products: c.products, l1 }]);
  }
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  cache = { at: Date.now(), byName, names };
  return cache;
}

/** Category names used by more than one category with products (they compete for the same search). */
export function duplicateNames(): Array<{ name: string; categories: Array<{ id: string; path: string; products: number }> }> {
  const out: Array<{ name: string; categories: Array<{ id: string; path: string; products: number }> }> = [];
  for (const [, list] of linkDictionary().byName) {
    if (list.length < 2) continue;
    out.push({
      name: list[0].name,
      categories: list
        .map(t => {
          const c = getCategory(t.id)!;
          return { id: t.id, path: [...ancestors(c), c].map(x => x.name).join(' > '), products: t.products };
        })
        .sort((a, b) => b.products - a.products),
    });
  }
  return out.sort((a, b) => b.categories.reduce((n, c) => n + c.products, 0) - a.categories.reduce((n, c) => n + c.products, 0));
}

function pick(cands: LinkTarget[], self: Category, selfL1: string): LinkTarget | undefined {
  const others = cands.filter(c => c.id !== self.id);
  if (!others.length) return undefined;
  // in-text links stay inside the page's main group: «استخر» in a fittings page is not a reason to link pool chemicals
  // (cross-group links come from a curated list of complementary categories, not from word matches)
  return others.filter(c => c.l1 === selfL1).sort((a, b) => b.products - a.products)[0];
}

/** Lines that must not get links: headings, table rows, lines that already carry a link. */
const skipLine = (l: string) => /^\s*#/.test(l) || /^\s*\|/.test(l) || /\]\(/.test(l);

/**
 * Plan in-text links for one page. `max` links in total; each target and each anchor at most once.
 * Matching ignores ZWNJ/spacing differences and needs word boundaries on both sides.
 */
export function planLinks(markdown: string, selfId: string, max = 5): PlannedLink[] {
  const self = getCategory(selfId);
  if (!self) return [];
  const selfL1 = ancestors(self)[0]?.id ?? self.id;
  const own = new Set([self, ...ancestors(self)].map(c => flat(c.name)));
  const { byName, names } = linkDictionary();
  const lines = markdown.split('\n');
  const flatLines = lines.map(l => (skipLine(l) ? '' : ` ${flat(l)} `));
  const used = new Set<string>();
  const taken: Array<{ line: number; from: number; to: number }> = [];
  const out: PlannedLink[] = [];
  for (const name of names) {
    if (out.length >= max) break;
    if (own.has(name)) continue; // the page's own name (and its parents' names) is the topic, not a link
    const target = pick(byName.get(name)!, self, selfL1);
    if (!target || used.has(target.id)) continue;
    for (let i = 0; i < flatLines.length; i++) {
      const at = flatLines[i].indexOf(` ${name} `);
      if (at < 0) continue;
      const span = { line: i, from: at, to: at + name.length + 2 };
      if (taken.some(t => t.line === i && t.from < span.to && span.from < t.to)) continue; // inside a longer anchor
      taken.push(span);
      used.add(target.id);
      out.push({ anchor: target.name, target, line: i });
      break;
    }
  }
  return out;
}

/**
 * Put planned links into the markdown: the first occurrence of the anchor on its line (ZWNJ/space tolerant),
 * keeping the page's own spelling as the link text.
 */
export function applyLinks(markdown: string, links: PlannedLink[]): string {
  const lines = markdown.split('\n');
  for (const l of links) {
    const words = flat(l.anchor).split(' ').map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(${words.join('[\\s\\u200c]+')})(?![\\p{L}\\p{N}])`, 'u');
    const line = lines[l.line];
    const m = line.match(re);
    if (!m || m.index === undefined) continue;
    lines[l.line] = `${line.slice(0, m.index)}[${m[1]}](${l.target.url})${line.slice(m.index + m[1].length)}`;
  }
  return lines.join('\n');
}

/** Related categories for a page: parent, main subcategories, nearest siblings. */
export function structuralLinks(selfId: string, opts: { children?: number; siblings?: number } = {}): { parent?: LinkTarget; children: LinkTarget[]; siblings: LinkTarget[] } {
  const self = getCategory(selfId);
  if (!self) return { children: [], siblings: [] };
  const toTarget = (c: Category): LinkTarget => ({ id: c.id, name: c.name, url: categoryUrl(c), products: c.products, l1: ancestors(c)[0]?.id ?? c.id });
  const parent = self.parent ? getCategory(self.parent) : undefined;
  return {
    ...(parent ? { parent: toTarget(parent) } : {}),
    children: childrenOf(self).slice(0, opts.children ?? 8).map(toTarget),
    siblings: siblingsOf(self).slice(0, opts.siblings ?? 4).map(toTarget),
  };
}
