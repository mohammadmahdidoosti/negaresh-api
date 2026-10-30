/**
 * GET /api/v1/content/keywords?resultId=…[&fresh=1] — Google Suggest research for the result's category, sorted by
 * intent, with the keyword gap against the page text and the product data. Read-only (cached 30 days).
 */
import { requireApiKey } from '@/lib/api/auth';
import { gapOf, researchCategory, seedsFor } from '@/lib/content/keywords';
import { getResult } from '@/lib/content/store';
import { ancestors, getCategory } from '@/lib/content/taxonomy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: Request) {
  const denied = requireApiKey(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const r = await getResult(url.searchParams.get('resultId') ?? '');
  if (!r) return Response.json({ ok: false, error: { code: 'not_found', message: 'نتیجه پیدا نشد.' } }, { status: 404 });
  const cat = getCategory(r.category.id);
  const synonyms = (cat?.synonyms ?? '').split(/[،,|]/).map(s => s.trim()).filter(s => s && s.length < 40);
  const parent = cat ? ancestors(cat).at(-1)?.name : undefined;
  const seeds = seedsFor(r.category.name, parent, synonyms);
  const rows = await researchCategory({ categoryId: r.category.id, name: r.category.name, seeds, fresh: url.searchParams.get('fresh') === '1', signal: request.signal });
  const page = [r.content.metaTitle, r.content.metaDescription, r.content.above, r.content.below].join('\n');
  const data = [r.data.catalog ?? '', r.data.brands.map(b => b.brand).join(' ')].join('\n');
  const withGap = gapOf(rows, r.category.name, page, data, r.category.path);
  const byIntent: Record<string, number> = {};
  for (const x of withGap) byIntent[x.intent] = (byIntent[x.intent] ?? 0) + 1;
  return Response.json({
    ok: true,
    category: r.category.name,
    total: withGap.length,
    byIntent,
    seeds,
    gaps: withGap.filter(x => x.relevant && !x.covered && x.supported),
    // searched, related, but not in the product data: ideas for the range, never written as if sold
    notInRange: withGap.filter(x => x.relevant && !x.covered && !x.supported).map(x => x.q),
    unrelated: withGap.filter(x => !x.relevant).length,
    rows: withGap,
  });
}
