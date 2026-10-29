/**
 * Market terms whose meaning the store has confirmed. The writer gets the confirmed definition whenever the term
 * occurs on the page's data (category name, path or product names), and QA flags a page that still describes the
 * term the wrong way. Add a term here only after the store owner confirms the definition.
 */
export interface VerifiedTerm {
  term: string;
  /** Matches the term in data and text (spelling variants). */
  match: RegExp;
  definition: string;
  /** A wrong description: the term within a few words of one of these. */
  wrong?: RegExp;
  wrongNote?: string;
}

export const VERIFIED_TERMS: VerifiedTerm[] = [
  {
    term: 'کوپلی',
    match: /کوپلی|کوپلر[\s‌]?(?:پیچی)?/,
    definition:
      'اتصال کوپلی (در بازار لوله و اتصالات پلی‌اتیلن) اتصال پیچی و مکانیکی است: لوله با مهره و اورینگ داخل اتصال محکم و آب‌بندی می‌شود، جوش و حرارت ندارد و می‌شود آن را باز و بسته کرد. با اتصال جوشی (جوش لب‌به‌لب) و الکتروفیوژن فرق دارد.',
    wrong: /(جوش|حرارت|ذوب|دستگاه\s*جوش)/,
    wrongNote: 'کوپلی اتصال پیچی با مهره و اورینگ است، نه جوشی یا حرارتی',
  },
];

/** Confirmed terms relevant to a page (the term appears in its data). */
export function termsFor(data: string): VerifiedTerm[] {
  return VERIFIED_TERMS.filter(t => t.match.test(data));
}

/**
 * Sentences that describe a confirmed term the wrong way, e.g. «کوپلی ... با جوش حرارتی». Only the sentence that
 * names the term counts, so «اتصال جوشی» elsewhere on the page is fine.
 */
export function wrongTermUses(text: string): Array<{ term: string; sentence: string; note: string }> {
  const out: Array<{ term: string; sentence: string; note: string }> = [];
  const sentences = text.split(/(?<=[.!؟?؛\n])\s+|\n+/).map(s => s.trim()).filter(Boolean);
  for (const t of VERIFIED_TERMS) {
    if (!t.wrong) continue;
    for (const s of sentences) {
      const m = s.match(t.match);
      if (!m) continue;
      // the clause that describes the term: from the term to the next comma/semicolon/table cell. «پرسی، کوپلی،
      // جوشی» lists kinds side by side and is fine; «کوپلی (جوشی)» or «کوپلی: با جوش حرارتی…» is not.
      const at = (m.index ?? 0) + m[0].length;
      const clause = s.slice(at).split(/[،,؛;|]/)[0].slice(0, 160);
      const w = clause.match(t.wrong);
      // «بدون جوش»، «جوش ندارد»، «نیازی به حرارت نیست» say the right thing
      const near = w ? clause.slice(Math.max(0, (w.index ?? 0) - 20), (w.index ?? 0) + w[0].length + 25) : '';
      if (w && !/(بدون|نه\s|نیازی|ندارد|نیست|نمی|نخواهد)/.test(near)) {
        out.push({ term: t.term, sentence: s.slice(0, 200), note: t.wrongNote ?? '' });
      }
    }
  }
  return out;
}
