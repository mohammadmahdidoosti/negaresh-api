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

const W = (alts: string) => new RegExp(`(?<![\\p{L}])(?:${alts})(?![\\p{L}])`, 'u');

/** Confirmed by the store owner (لوله و اتصالات, 2026-10-29). */
export const VERIFIED_TERMS: VerifiedTerm[] = [
  {
    term: 'کوپلی',
    match: W('کوپلی'),
    definition:
      'اتصال کوپلی (در بازار لوله و اتصالات پلی‌اتیلن) اتصال پیچی و مکانیکی است: لوله با مهره و اورینگ داخل اتصال محکم و آب‌بندی می‌شود، جوش و حرارت ندارد و می‌شود آن را باز و بسته کرد. با اتصال جوشی (جوش لب‌به‌لب) و الکتروفیوژن فرق دارد.',
    wrong: /(جوش|حرارت|ذوب|دستگاه\s*جوش)/,
    wrongNote: 'کوپلی اتصال پیچی با مهره و اورینگ است، نه جوشی یا حرارتی',
  },
  {
    term: 'پوشفیت',
    match: W('پوشفیت|پوش\\s?فیت'),
    definition: 'اتصال پوشفیت: سر لوله داخل کاسهٔ اتصال فشار داده می‌شود و اورینگ لاستیکی آن را آب‌بندی می‌کند؛ بیشتر در فاضلاب (پلی‌پروپیلن و پلیکا) رایج است.',
    wrong: /(جوش|حرارت|ذوب|چسب)/,
    wrongNote: 'پوشفیت با فشار و اورینگ آب‌بندی می‌شود، نه با جوش یا چسب',
  },
  {
    term: 'پرسی',
    match: W('پرسی'),
    definition: 'اتصال پرسی مخصوص لوله‌های پنج‌لایه است: بوش فلزی اتصال با فک دستگاه پرس روی لوله پرس می‌شود و اتصال دائمی است.',
    wrong: /(جوش|حرارت|ذوب)/,
    wrongNote: 'پرسی با دستگاه پرس روی لولهٔ پنج‌لایه بسته می‌شود، نه با جوش',
  },
  {
    term: 'جوشی',
    match: W('جوشی'),
    definition: 'اتصال جوشی: در پلی‌اتیلن جوش لب‌به‌لب با دستگاه جوش؛ در پلی‌پروپیلن (لوله سبز) جوش سوکتی با «اتو».',
  },
  {
    term: 'الکتروفیوژن',
    match: W('الکتروفیوژن|الکترو\\s?فیوژن'),
    definition: 'اتصال الکتروفیوژن: اتصال پلی‌اتیلن با سیم‌پیچ داخلی؛ دستگاه الکتروفیوژن به آن برق می‌دهد تا ذوب و جوش شود.',
  },
  {
    term: 'تزریقی',
    match: W('تزریقی'),
    definition: 'اتصال تزریقی: اتصال پلی‌اتیلن که یکپارچه در قالب تزریق ساخته شده است، نه با بریدن و جوشکاری لوله.',
  },
  {
    term: 'فلنج‌دار هسته فولادی',
    match: /هسته[‌ ]?(?:ی\s)?فولادی/,
    definition: 'اتصال فلنج‌دار هسته فولادی: اتصال پلی‌اتیلن با فلنج که برای استحکام، هستهٔ فولادی دارد.',
  },
  {
    term: 'کوپله (در اتصالات پلیکا)',
    match: W('کوپله|دو\\s?سر\\s?کوپله|یک\\s?سر\\s?کوپله'),
    definition: 'در اتصالات پلیکا «کوپله» یعنی سرِ کاسه‌دار (مادگی) که لوله داخلش می‌رود؛ «دوسر کوپله» یعنی هر دو سر کاسه دارد و «یک‌سر کوپله» یعنی فقط یک سر. با «کوپلی» پلی‌اتیلن (اتصال پیچی) فرق دارد.',
  },
  {
    term: 'دوسرکوپلر (الکتروفیوژن)',
    match: W('دو\\s?سر\\s?کوپلر'),
    definition: 'دوسرکوپلر: اتصال الکتروفیوژن که هر دو سرش کوپلر الکتروفیوژن است.',
  },
  {
    term: 'رده ۴۰',
    match: /رده\s*(?:40|۴۰)/,
    definition: 'رده ۴۰: کلاس ضخامت دیوارهٔ اتصال فولادی (Schedule 40).',
  },
  {
    term: 'پلیکا',
    match: W('پلیکا|پولیکا'),
    definition: 'پلیکا: نام بازاری لوله و اتصالات PVC-U (یو پی وی سی).',
  },
  {
    term: 'C-PVC',
    match: /C[-\s]?PVC|سی\s?پی\s?وی\s?سی/i,
    definition: 'C-PVC: نوعی PVC که دمای بالاتر را تحمل می‌کند و برای آب گرم هم مناسب است.',
  },
  {
    term: 'سایلنت',
    match: W('سایلنت'),
    definition: 'سایلنت: لوله و اتصالات فاضلابی کم‌صدا.',
  },
  {
    term: 'بوشن فلزی',
    match: /بوشن/,
    definition: 'بوشن فلزی: اتصال پلی‌پروپیلن با مهرهٔ رزوه‌دار فلزی (برنجی) برای وصل شدن به شیرآلات یا قطعات رزوه‌دار.',
  },
  {
    term: 'مغزی',
    match: W('مغزی'),
    definition: 'مغزی: قطعهٔ کوتاهی که هر دو سرش رزوهٔ بیرونی (روپیچ) دارد و دو قطعهٔ توپیچ را به هم وصل می‌کند.',
    wrong: /(رزوه[‌ٔ ]*(?:ی\s)?داخلی|توپیچ\s+است|ماده\s+است)/,
    wrongNote: 'مغزی دو سر روپیچ (رزوهٔ بیرونی) دارد، نه رزوهٔ داخلی',
  },
  {
    term: 'روپیچ / توپیچ',
    match: W('روپیچ|توپیچ'),
    definition: 'روپیچ (نر) یعنی رزوه بیرون قطعه است؛ توپیچ (ماده) یعنی رزوه داخل قطعه است.',
  },
  {
    term: 'چپقی',
    match: W('چپقی'),
    definition: 'چپقی: زانویی که یک سرش نر (روپیچ) و سر دیگرش ماده (توپیچ) است.',
  },
  {
    term: 'کلمپی',
    match: W('کلمپی|کلمپ'),
    definition: 'کلمپی: انشعاب کمربندی که با پیچ دور لولهٔ پلی‌اتیلن بسته می‌شود تا از آن انشعاب گرفته شود.',
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
      // «پرسی، کوپلی و جوشی …» also lists kinds: a clause that goes on with «و/یا + another kind» is a list
      const clause = s.slice(at).split(/[،,؛;|]/)[0].slice(0, 160);
      if (/^\s*(?:\*\*)?\s*(?:و|یا)\s+(?:اتصال(?:ات)?\s+)?(?:جوشی|الکتروفیوژن|پوشفیت|پرسی|کلمپی|رزوه)/.test(clause)) continue;
      const w = clause.match(t.wrong);
      // «بدون جوش»، «جوش ندارد»، «نیازی به حرارت نیست» say the right thing
      const near = w ? clause.slice(Math.max(0, (w.index ?? 0) - 20), (w.index ?? 0) + w[0].length + 25) : '';
      // «پوشفیت بهتر است یا چسبی؟» compares two kinds; it does not describe the term
      const comparison = w ? /(?:^|\s)(?:یا|و)\s*$/.test(clause.slice(0, w.index)) : false;
      if (w && !comparison && !/(بدون|نه\s|نیازی|ندارد|نیست|نمی|نخواهد)/.test(near)) {
        out.push({ term: t.term, sentence: s.slice(0, 200), note: t.wrongNote ?? '' });
      }
    }
  }
  return out;
}
