/**
 * Prompts for category-page content. Versioned so every result records which prompt produced it.
 * The drafting prompt is the client's original prompt (کاروان صنعت), adapted for category pages.
 */
import type { Tier } from './taxonomy';

export const PROMPT_VERSION = 'content-v1.7';

export interface BriefInput {
  category: {
    name: string;
    path: string;
    level: number;
    synonyms: string;
    productCount: number;
    tier: Tier;
    marketNameNote?: string;
  };
  l1Profile: unknown;
  l2Profile: unknown;
  siblings: string[];
  children: string[];
  products: { sample: string[]; brands: Array<{ brand: string; count: number }>; specs: Record<string, string[]>; note?: string };
}

export interface Brief {
  angle: string;
  audience: 'B2B' | 'B2C' | 'mixed';
  search_intent: string;
  term_explanation: string;
  lsi: string[];
  facts: Array<{ fact: string; evidence: string }>;
  brands: Array<{ name: string; evidence: string }>;
  headings: Array<{ h2: string; covers: string; format: 'paragraph' | 'bullets' | 'table' }>;
  table: { title: string; columns: string[] } | null;
  check_before_order: string[];
  common_mistakes: string[];
  glossary: Array<{ term: string; explain: string }>;
  faq: string[];
  cautions: string[];
}

const HEADINGS_BY_TIER: Record<Tier, string> = { hub: '۶ تا ۸', standard: '۴ تا ۶', small: '۳ تا ۴', skip: '۳' };

export function briefMessages(input: BriefInput) {
  const system = `تو برنامه‌ریز محتوای صفحه‌های دسته‌بندی محصول در فروشگاه اینترنتی «کاروان صنعت» (تجهیزات صنعتی، ساختمانی و کشاورزی) هستی.
از روی دادهٔ واقعی (نام محصولات موجود در همین دسته)، پروفایل دسته‌های والد و جایگاه دسته در درخت، یک بریف دقیق برای نویسنده بساز.

قواعد:
1. نام دسته همان کلمهٔ کلیدی است که در بازار جستجو می‌شود؛ آن را تغییر نده و اصلاح نکن. اگر نام برای خواننده نامفهوم است یا اصطلاح بازار است (مثل PU، N.O، 2-2، «طرح رکسروت»)، در term_explanation با کمک مسیر دسته و نام محصولات توضیح بده که منظور چیست. اگر نام روشن است، term_explanation خالی بماند.
2. زاویهٔ صفحه (angle) را طوری انتخاب کن که با دسته‌های هم‌سطح (siblings) و والد رقابت نکند: صفحهٔ برندی ← معرفی محصولات همان برند در این نوع؛ صفحهٔ نوع کلی ← انتخاب و مقایسهٔ انواع؛ صفحهٔ سایز/مدل/ظرفیت ← مشخصات و کاربرد همان مدل.
3. اگر پروفایل L2 داده شده و این صفحه خودِ همان L2 است، از تیترهای آن استفاده کن و بهترشان کن. اگر این صفحه زیرمجموعهٔ عمیق‌تر است، تیترها را مخصوص همین صفحه بنویس؛ کپی کردن تیترهای والد ممنوع است. هیچ تیتری «[کلمه کلیدی]» یا قالب عمومی نباشد.
4. بریف را فشرده نگه دار: حداکثر ۱۲ مورد در facts، ۵ برند، و جمله‌های کوتاه. facts فقط چیزهایی است که مستقیماً از نام محصولات برمی‌آید (برند، سایز، ظرفیت، ولتاژ، جریان، مدل، نوع، جنس). evidence باید عیناً نام یکی از محصولات باشد. بازه‌ها را از products.specs بساز (مثلاً «جریان نامی موجود: ۹ تا ۹۵ آمپر»). اگر دادهٔ محصول نیست، facts خالی بماند.
5. brands فقط از products.brands یا نام محصولات. «طرح X» یعنی هم‌اندازه با برند X، نه کالای اصل؛ آن را به‌صورت «طرح X» ثبت کن.
6. check_before_order: ۳ تا ۵ مورد سازگاری یا انتخاب که مخصوص همین محصول است (مثلاً سایز رزوه، ولتاژ بوبین، تعداد پل). common_mistakes: ۲ تا ۳ اشتباه رایج واقعی در انتخاب یا نصب همین محصول.
7. تعداد تیترها (بدون احتساب سؤالات متداول و بخش پایانی خرید): ${HEADINGS_BY_TIER[input.category.tier]}.
8. هیچ عدد، استاندارد، گواهی یا ادعای عملکردی خارج از facts و پروفایل‌ها ننویس. استانداردهای پروفایل فقط «مرجع حوزه» هستند.
9. مخاطب را صادقانه تعیین کن: اگر خریداران خانگی یا تعمیرکارند، B2C یا mixed.
10. همهٔ متن‌ها فارسی روان با نیم‌فاصلهٔ درست.

فقط یک شیء JSON معتبر با این کلیدها برگردان (بدون توضیح اضافه و بدون \`\`\`):
{"angle": "…", "audience": "B2B|B2C|mixed", "search_intent": "…", "term_explanation": "…",
 "lsi": ["۸ تا ۱۲ مفهوم تخصصی مرتبط با همین صفحه"],
 "facts": [{"fact": "…", "evidence": "نام دقیق محصول"}],
 "brands": [{"name": "…", "evidence": "نام دقیق محصول"}],
 "headings": [{"h2": "…", "covers": "در یک خط: چه چیزی زیر این تیتر می‌آید", "format": "paragraph|bullets|table"}],
 "table": {"title": "…", "columns": ["حداکثر ۴ ستون"]} یا null,
 "check_before_order": ["…"], "common_mistakes": ["…"],
 "glossary": [{"term": "…", "explain": "…"}],
 "faq": ["سؤال‌های واقعی خریدار"], "cautions": ["…"]}`;
  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: JSON.stringify(input) },
  ];
}

export interface DraftInput {
  category: BriefInput['category'];
  industry: string;
  brief: Brief;
  tone: string;
  audienceDesc: string;
  sectionRules: { include: string[]; exclude: string[] };
  profileCautions: string[];
  words: { min: number; max: number };
}

const FAQ_BY_TIER: Record<Tier, string> = { hub: '۴ تا ۵', standard: '۳', small: '۲', skip: '۲' };

export function draftMessages(input: DraftInput) {
  const { tier } = input.category;
  const extraSections =
    tier === 'small'
      ? '- برای این صفحهٔ کوچک، بخش «اشتباهات رایج» و «اصطلاحات» را فقط اگر واقعاً لازم است و در حد ۲ بولت بیاور.'
      : `- یک بخش «اشتباهات رایج در انتخاب یا نصب» (۲ تا ۳ مورد از بریف).
- اگر در تیترهای بریف بخشی دربارهٔ نصب یا نگهداری نیست، ۲ تا ۳ نکتهٔ کاربردی انتخاب، نصب یا نگهداری را هم بیاور (به‌صورت توصیهٔ فنی، نه ادعای تجربهٔ شخصی).
- اگر glossary بریف خالی نیست، بخش کوتاه «اصطلاحات رایج بازار» (بولت: اصطلاح — توضیح ساده).`;

  const system = `تو یک کپی‌رایتر ارشد و متخصص سئو (مسلط به E-E-A-T و Helpful Content) در حوزهٔ تجهیزات صنعتی، ساختمانی و کشاورزی هستی. وظیفهٔ تو نوشتن محتوای **صفحهٔ دسته‌بندی محصول** فروشگاه اینترنتی «کاروان صنعت» است، نه مقالهٔ وبلاگ. این متن کنار لیست محصولات نمایش داده می‌شود: یک بخش کوتاه بالای لیست و یک راهنمای کامل زیر لیست.

متغیرهای محتوا در پیام کاربر آمده است: کلمهٔ کلیدی اصلی (= نام دسته، دقیقاً به همان شکل)، دسته و صنعت، مفاهیم تخصصی و LSI، تیترهای الزامی، مخاطب، واقعیت‌های قابل استناد، برندها، اصطلاحات، نکات «قبل از سفارش»، اشتباهات رایج، سؤالات متداول و هشدارها.

## لحن
- حرفه‌ای، دقیق، متقاعدکننده و بدون تکلف. لحن را با مخاطب تنظیم کن: B2B ← مستقیم با مهندسان، پیمانکاران، تابلوسازان و مدیران خرید؛ B2C ← ساده، صمیمی و دقیق برای مصرف‌کنندهٔ خانگی و تعمیرکار؛ mixed ← ساده با جزئیات فنی کافی.
- لحن و مخاطب این صفحه: ${input.tone} | ${input.audienceDesc}
- از داستان‌سرایی، لحن احساسی یا عامیانه، اغراق، ترفندهای تبلیغاتی و جمله‌های کلیشه‌ای («در دنیای امروز»، «همان‌طور که می‌دانید»، «در این مقاله») به‌شدت پرهیز کن.
- اضافه‌گویی و تکرار ممنوع؛ هر پاراگراف باید اطلاعات تازه و کاربردی بدهد.
- مفاهیم تخصصی و LSI را طبیعی و در جایگاه درست فنی در متن پخش کن (هر کدام یک یا دو بار؛ پر کردن کلمه ممنوع).

## صحت (بسیار مهم)
- هیچ عدد، رتبه، استاندارد، گواهی، طول عمر، درصد یا ادعای عملکردی را به محصولات نسبت نده، مگر در «واقعیت‌های قابل استناد» آمده باشد. استانداردها را فقط به‌عنوان مرجع حوزه نام ببر، نه ادعای انطباق محصول.
- فقط برندهای فهرست «برندها» را نام ببر. «طرح X» را کالای اصل برند X معرفی نکن.
- قیمت، تخفیف، زمان ارسال، گارانتی یا وضعیت موجودی را ننویس (لیست محصولات این‌ها را نشان می‌دهد).
- تجربهٔ شخصی نساز («ما در پروژه‌ها دیده‌ایم»). نکته‌ها را به‌صورت توصیهٔ فنی بنویس.
- اگر اطلاعاتی لازم است ولی در داده نیست، کلی و بدون عدد بنویس. فقط اگر یک ادعای مشخص واقعاً ضروری است، به جای آن [[نیاز به منبع]] بگذار (حداکثر ۲ بار).
- «کاروان صنعت» را تأمین‌کنندهٔ این تجهیزات معرفی کن، بدون ادعاهایی مثل «بزرگ‌ترین» یا «بهترین».
- هشدارهای این حوزه: ${[...input.profileCautions, ...input.brief.cautions].join(' | ') || '—'}
- بخش‌های مناسب این حوزه: ${input.sectionRules.include.join('، ') || '—'} | بخش‌های نامناسب: ${input.sectionRules.exclude.join('، ') || '—'}

## ساختار خروجی (دقیقاً با همین نشانه‌ها، هر نشانه در یک خط جدا)
===ABOVE===
متن کوتاه بالای لیست محصولات: ۶۰ تا ۱۱۰ کلمه، بدون تیتر، در یک یا دو پاراگراف کوتاه.
- جملهٔ اول نام دقیق دسته را دارد و با یک چالش فنی یا کاربردی رایج می‌گوید این محصول چیست و چه مشکلی را حل می‌کند.
- برای چه کسی و کجا مناسب است، و مهم‌ترین نکتهٔ انتخاب.
- اگر term_explanation بریف خالی نیست، همین‌جا نام دسته را در یک عبارت توضیح بده.
- یک اشارهٔ کوتاه که انواع موجود در کاروان صنعت در لیست زیر آمده است.
===BELOW===
راهنمای کامل زیر لیست محصولات، به Markdown:
- **هیچ H1 (# ) ننویس.** قالب سایت نام دسته را H1 صفحه می‌کند؛ راهنما با H2 (## ) شروع شود.
- نام دقیق دسته در ۱۰۰ کلمهٔ اول راهنما بیاید.
- تیترهای بریف را به ترتیب به‌عنوان H2 بنویس (در صورت نیاز H3). برای مقایسه‌ها و مشخصات از جدول Markdown (حداکثر ۴ ستون تا در موبایل خوانا باشد) و برای ویژگی‌ها از بولت استفاده کن. جدول فقط از واقعیت‌های قابل استناد یا ویژگی‌های کیفی ساخته شود؛ عدد ساختگی ممنوع.
- هر بخش با یک جملهٔ خلاصه شروع شود؛ پاراگراف‌ها کوتاه (حداکثر ۴ جمله).
- بخش «قبل از سفارش این موارد را بررسی کنید» (بولت، از نکات بریف).
${extraSections}
- سؤالات متداول: یک H2 مانند «سوالات متداول دربارهٔ ${input.category.name}» و هر سؤال یک H3 با پاسخ کوتاه و دقیق (۲ تا ۴ جمله). تعداد سؤال‌ها: ${FAQ_BY_TIER[tier]}.
- بخش پایانی با یک تیتر H2 جذاب (هرگز «نتیجه‌گیری» یا «جمع‌بندی»): مزیت‌های کلیدی در دو خط، سپس دعوت به دریافت مشاورهٔ فنی، استعلام قیمت عمده و خرید مستقیم از فروشگاه آنلاین کاروان صنعت.
- طول راهنما: ${input.words.min} تا ${input.words.max} کلمه.
===META_TITLE===
عنوان سئو: حداکثر ۶۰ نویسه، با نام دقیق دسته در ابتدا و در صورت جا شدن «| کاروان صنعت».
===META_DESCRIPTION===
توضیح متا: ۱۲۰ تا ۱۵۵ نویسه، شامل نام دسته و یک دلیل روشن برای کلیک؛ بدون قیمت و اغراق.
===END===

## نگارش فارسی
نیم‌فاصلهٔ استاندارد (می‌شود، دسته‌بندی‌ها، کاربردی‌ترین)، اعداد فارسی در متن، و اصطلاح لاتین فقط وقتی در بازار رایج است، یک بار در پرانتز.`;

  const user = {
    'کلمه کلیدی اصلی (نام دسته)': input.category.name,
    'مسیر دسته': input.category.path,
    'دسته / صنعت': input.industry,
    'سطح محتوا': tier,
    'تعداد محصول در سایت': input.category.productCount,
    'زاویهٔ صفحه': input.brief.angle,
    'نیت جستجو': input.brief.search_intent,
    'مخاطب': input.brief.audience,
    'توضیح نام دسته (اگر لازم است)': input.brief.term_explanation,
    'مفاهیم تخصصی و LSI': input.brief.lsi,
    'تیترهای الزامی': input.brief.headings,
    'جدول پیشنهادی': input.brief.table,
    'واقعیت‌های قابل استناد (فقط این‌ها)': input.brief.facts.map(f => f.fact),
    'برندها (فقط این‌ها)': input.brief.brands.map(b => b.name),
    'قبل از سفارش': input.brief.check_before_order,
    'اشتباهات رایج': input.brief.common_mistakes,
    'اصطلاحات': input.brief.glossary,
    'سؤالات متداول': input.brief.faq,
    'مترادف‌ها': input.category.synonyms,
  };
  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: JSON.stringify(user, null, 1) },
  ];
}

/** Serialize sections back into the marker format (used by the repair pass). */
export function formatDraft(d: DraftSections): string {
  return `===ABOVE===\n${d.above}\n===BELOW===\n${d.below}\n===META_TITLE===\n${d.metaTitle}\n===META_DESCRIPTION===\n${d.metaDescription}\n===END===`;
}

/**
 * Some models nest every section under one H2 (## title, ### sections, #### questions).
 * When the page has a single H2 followed by several H3, lift all deeper headings one level.
 */
export function normalizeHeadings(md: string): string {
  const h2 = (md.match(/^##[ \t]/gm) ?? []).length;
  const h3 = (md.match(/^###[ \t]/gm) ?? []).length;
  if (h2 > 1 || h3 < 3) return md;
  return md.replace(/^(#{3,6})([ \t])/gm, (_m, hashes: string, sp: string) => `${hashes.slice(1)}${sp}`);
}

/** Targeted edit of a draft: fix only the listed QA problems and return the same marker format. */
export function repairMessages(name: string, draft: DraftSections, problems: string[]) {
  const system = `تو ویراستار ارشد محتوای فروشگاه «کاروان صنعت» هستی. یک پیش‌نویس صفحهٔ دسته و فهرست ایرادهای کنترل کیفیت به تو داده می‌شود.
فقط همین ایرادها را درست کن و بقیهٔ متن را تا حد ممکن دست‌نخورده نگه دار: ساختار، تیترها، جدول‌ها، سؤالات متداول و بخش پایانی بمانند.
نام دسته «${name}» کلمهٔ کلیدی است و دقیقاً به همین شکل بماند. هیچ اطلاعات، عدد، برند یا ادعای تازه اضافه نکن.
خروجی را دقیقاً با همان نشانه‌ها برگردان: ===ABOVE===، ===BELOW===، ===META_TITLE===، ===META_DESCRIPTION===، ===END===. هیچ توضیحی قبل یا بعد ننویس.`;
  const user = `ایرادها:\n${problems.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nپیش‌نویس:\n${formatDraft(draft)}`;
  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
}

/** Put back the ZWNJs a model dropped («میرود» → «می‌رود»). Nothing else may change. */
export function zwnjMessages(markedDraft: string) {
  return [
    { role: 'system' as const, content: 'تو ویراستار املای فارسی هستی. در متن زیر نیم‌فاصله‌ها (U+200C) جا افتاده‌اند و کلمه‌ها به هم چسبیده‌اند، مثل «میرود»، «قطعکننده»، «لولهها». فقط نیم‌فاصله‌های استاندارد را بگذار («می‌رود»، «قطع‌کننده»، «لوله‌ها»). هیچ کلمه، حرف، علامت یا خطی را تغییر نده، اضافه یا حذف نکن. همان نشانه‌های ===ABOVE=== و بقیه را دقیقاً نگه دار و فقط متن اصلاح‌شده را برگردان.' },
    { role: 'user' as const, content: markedDraft },
  ];
}

export interface DraftSections {
  above: string;
  below: string;
  metaTitle: string;
  metaDescription: string;
}

export function parseDraft(raw: string): DraftSections {
  // Tolerant markers: "===TAG===", "=== TAG ===", "**===TAG===**" (some models decorate them).
  const grab = (tag: string) => {
    const m = raw.match(new RegExp(`\\**={2,}\\s*${tag}\\s*={2,}\\**[ \\t]*\\n?([\\s\\S]*?)(?=\\**={2,}\\s*[A-Z_]+\\s*={2,}|$)`));
    return (m?.[1] ?? '').trim();
  };
  return { above: grab('ABOVE'), below: grab('BELOW'), metaTitle: grab('META_TITLE'), metaDescription: grab('META_DESCRIPTION') };
}

export function parseBrief(raw: string): Brief {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('بریف JSON معتبر برنگرداند');
  const b = JSON.parse(raw.slice(start, end + 1)) as Partial<Brief>;
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    angle: String(b.angle ?? ''),
    audience: (['B2B', 'B2C', 'mixed'].includes(String(b.audience)) ? b.audience : 'mixed') as Brief['audience'],
    search_intent: String(b.search_intent ?? ''),
    term_explanation: String(b.term_explanation ?? ''),
    lsi: arr<string>(b.lsi).map(String),
    facts: arr<Brief['facts'][number]>(b.facts).filter(f => f && f.fact),
    brands: arr<Brief['brands'][number]>(b.brands).filter(x => x && x.name),
    headings: arr<Brief['headings'][number]>(b.headings).filter(h => h && h.h2),
    table: b.table && Array.isArray(b.table.columns) ? b.table : null,
    check_before_order: arr<string>(b.check_before_order).map(String),
    common_mistakes: arr<string>(b.common_mistakes).map(String),
    glossary: arr<Brief['glossary'][number]>(b.glossary).filter(g => g && g.term),
    faq: arr<string>(b.faq).map(String),
    cautions: arr<string>(b.cautions).map(String),
  };
}
