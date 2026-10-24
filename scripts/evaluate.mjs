/** Live editorial acceptance suite with adaptive tolerance and resilient anchor normalization. */
import { createJiti } from 'jiti';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { diagnoseProvider } from './provider-diagnostics.mjs';

const jiti = createJiti(import.meta.url, {
	tryNative: false,
	alias: { '@': new URL('../src', import.meta.url).pathname },
});

const { rewriteText, analyzeEeat, createExecutionContext } = await jiti.import('../src/lib/humanizer.ts');
const { assessPublicationReadiness } = await jiti.import('../src/lib/publication.ts');
const { lintRequest } = await jiti.import('../src/lib/linter.ts');

const { usageSummary } = await jiti.import('../src/lib/usage-ledger.ts');
const { lengthAssessment } = await jiti.import('../src/lib/length.ts');
const { countWords } = await jiti.import('../src/lib/text.ts');
if (process.argv.includes('--diagnose')) {
  console.log(JSON.stringify(await diagnoseProvider(), null, 2));
  process.exit(0);
}
if (process.argv.includes('--separate-review')) process.env.LLM_COMBINED_REVIEW = 'false';
const modelArg = process.argv.find(value => value.startsWith('--model='))?.slice(8);
if (modelArg) {
  process.env.LLM_WRITER_MODEL = modelArg;
  process.env.LLM_REFINER_MODEL = modelArg;
}

// --- Helper: Resilient normalization for Persian digits, ZWNJ, and URLs ---
function normalizeToken(str) {
	return str
		.replace(/[۰-۹]/g, d => '0123456789'['۰۱۲۳۴۵۶۷۸۹'.indexOf(d)])
		.replace(/[\u200c\s]+/g, ' ')
		.replace(/\/+$/, '')
		.trim()
		.toLowerCase();
}

function containsAnchor(haystack, needle) {
	const normHaystack = normalizeToken(haystack);
	const normNeedle = normalizeToken(needle);
	return normHaystack.includes(normNeedle);
}

const cases = [
	{
		id: 'howto',
		title: 'Step-by-step UI How-to',
		request: {
			text: '۱. در بخش Target مخاطب را انتخاب کنید. ۲. روی Create a new ad بزنید. ۳. بودجه را روی ۲۰ تنظیم کنید. ۴. پیش از Confirm مقدار بودجه را دوباره بررسی کنید. تا تنظیمات درست نشده Confirm را نزنید. راهنما: https://example.com/help',
			voice: 'roughcut',
			contentType: 'howto',
			quality: 'readable',
			articleGoal: 'User successfully configures and submits campaign without operational errors',
			audience: 'Store manager launching their first campaign',
			keywords: ['Target', 'Create a new ad', 'Confirm'],
		},
		anchors: ['Target', 'Create a new ad', 'Confirm', '20', 'https://example.com/help'],
		forbidden: [/تجربه شخصی من/, /در فروشگاه ما/, /دانشجوی من/, /کلینیک ما/],
		maxFluffDensity: 0.12,
	},
	{
		id: 'ymyl',
		title: 'Strict YMYL Health Claim',
		request: {
			text: 'مصرف روزانه ۵۰۰۰ واحد ویتامین D فشار خون را قطعا درمان می کند و برای همه بی خطر است.',
			voice: 'formal',
			contentType: 'ymyl_health',
			quality: 'strict',
			articleGoal: 'Prudently hedge an ungrounded health claim for editorial review',
			audience: 'General public seeking health information',
			keywords: ['ویتامین D'],
		},
		anchors: ['5000', 'ویتامین D'],
		forbidden: [/کلینیک (?:ما|من)/, /بیمار(?:ان)? (?:ما|من)/, /مطالعه دانشگاه تهران/],
		needsSource: true,
		forbidLintCategories: ['false_certainty'],
	},
	{
		id: 'standard',
		title: 'Precise Standard Explainer',
		request: {
			text: 'در دنیای امروز، انتخاب سرویس Acme از اهمیت بسزایی برخوردار می باشد. شایان ذکر است که این سرویس در سال ۱۴۰۳ تعداد ۱۲ قابلیت داشت. به طور کلی، کاربران می توانند اطلاعات محصول را در https://example.com/acme مشاهده کنند. در نهایت، می توان نتیجه گرفت که Acme گزینه مناسبی است.',
			voice: 'standard',
			contentType: 'general',
			quality: 'precise',
			articleGoal: 'Explain available specifications concisely without introducing novel claims',
			audience: 'Prospective buyer conducting preliminary evaluation',
			keywords: ['Acme'],
		},
		anchors: ['Acme', '1403', '12', 'https://example.com/acme'],
		forbidden: [/در دنیای امروز/, /شایان ذکر است/, /لازم به ذکر است/],
		maxFluffDensity: 0.15,
	},
	{
		id: 'depth',
		title: 'Long-form Technical Guide with Empirical Depth',
		request: {
			text: 'برای ثبت کمپین Acme ابتدا Target را باز کنید و گروه مخاطب متناسب با محدوده جغرافیایی فروشگاه را انتخاب کنید. سپس Create a new ad را بزنید و بودجه را روی ۲۰ تنظیم کنید. اگر مقدار بودجه کمتر از ۲۰ باشد، پنل هشدار B-17 را نشان می دهد و دکمه Confirm فعال نمی شود. این محدودیت به دلیل حداقل بودجه تعریف شده در نسخه ۱۴۰۳ پنل است. بعد از اصلاح مقدار، تنظیمات را دوباره بخوانید و Confirm را بزنید. وقتی Target روی broad قرار دارد، بررسی محدوده جغرافیایی ضروری است؛ زیرا انتخاب محدوده اشتباه باعث می شود نمایش آگهی بیرون از منطقه هدف انجام شود. در آزمون داخلی نویسنده در محیط آزمایشی، ذخیره تنظیمات پس از Confirm حدود ۴۵ ثانیه طول کشید و بستن صفحه پیش از پایان این زمان باعث ثبت نشدن کمپین شد. اگر هشدار B-17 با بودجه ۲۰ همچنان باقی ماند، صفحه را یک بار تازه سازی کنید و مقدار را دوباره وارد کنید. راهنمای پنل در https://example.com/acme-help قرار دارد. این مراحل باید به همان ترتیب اجرا شوند تا تنظیمات اصلی، بودجه و محدوده مخاطب پیش از ثبت نهایی کنترل شوند.',
			voice: 'standard',
			contentType: 'howto',
			quality: 'precise',
			articleGoal:
				'User configures Acme campaign accurately, adheres to budget constraints, and resolves known edge cases',
			audience: 'Store manager configuring the panel for the first time',
			sources:
				'راهنمای آزمایشی پنل در https://example.com/acme-help صریحاً می گوید نسخه ۱۴۰۳ حداقل بودجه ۲۰ دارد و بودجه کمتر از ۲۰ هشدار B-17 را فعال می کند.',
			notes: 'در آزمون داخلی نویسنده در محیط آزمایشی، ذخیره پس از Confirm حدود ۴۵ ثانیه طول کشید و خروج زودهنگام مانع ثبت شد.',
			authorProfile: 'Product specialist who verified this panel build in a staging environment.',
			keywords: ['Acme', 'Target', 'Create a new ad', 'Confirm', 'B-17'],
		},
		anchors: [
			'Acme',
			'Target',
			'Create a new ad',
			'Confirm',
			'B-17',
			'20',
			'1403',
			'45',
			'https://example.com/acme-help',
		],
		forbidden: [/کلینیک/, /دانشگاه تهران/, /طبق تحقیقات/],
		maxFluffDensity: 0.15,
	},
];

cases.push({
  id: 'longform', title: 'Full-length Persian editorial guide (1,500-word target)',
  request: {
    text: readFileSync(new URL('../tests/fixtures/longform-persian.md', import.meta.url), 'utf8'),
    voice: 'standard', contentType: 'howto', quality: 'precise', targetWords: 1500, wordTolerance: .1,
    articleGoal: 'راهنمای روشن تحویل مقاله در تحریریه کوچک؛ حفظ محدودیت‌ها و مثال‌های صریحاً فرضی.',
    audience: 'نویسنده و ویراستار یک تحریریه کوچک',
  },
  anchors: [], forbidden: [/در تجربه شخصی من/, /طبق تحقیقات/, /دانشگاه تهران/], maxFluffDensity: .15,
});
const requested = process.argv.find(value => value.startsWith('--case='))?.slice(7) ?? process.argv.slice(2).find(value => !value.startsWith('--'));
const unknownOption = process.argv.slice(2).find(value => value.startsWith('--') && !/^(?:--(?:case|model|budget)=.+|--(?:diagnose|separate-review|dry-run|list))$/.test(value));
if (unknownOption) throw new Error(`Unknown option: ${unknownOption}`);
const selected = requested ? cases.filter(item => item.id === requested) : cases;
if (!selected.length) {
	console.error(`Unknown case ID: "${requested}". Available options: ${cases.map(item => item.id).join(', ')}`);
	process.exit(2);
}

if (process.argv.includes('--dry-run') || process.argv.includes('--list')) {
  console.log(JSON.stringify(selected.map(item => ({ id: item.id, inputWords: countWords(item.request.text),
    inputCharacters: item.request.text.length, target: item.request.targetWords ?? null })), null, 2));
  process.exit(0);
}
const budget = Number(process.argv.find(value => value.startsWith('--budget='))?.slice(9) ?? '.50');
if (!Number.isFinite(budget) || budget <= 0) throw new Error('--budget must be a positive USD amount');
const before = usageSummary();
const startCommitted = before.knownCostUsd + before.unsettledReserveUsd;
const existingLimit = process.env.LLM_BUDGET_USD?.trim() ? Number(process.env.LLM_BUDGET_USD) : Infinity;
if (Number.isNaN(existingLimit)) throw new Error('Invalid LLM_BUDGET_USD');
process.env.LLM_BUDGET_USD = String(Math.min(existingLimit, startCommitted + budget));
const reportDir = resolve('.local/evaluations', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(reportDir, { recursive: true, mode: 0o700 });
const reports = [];
console.log('Evaluation maximum additional commitment (USD):', budget);
console.log('Private report directory:', reportDir);
let failed = false;
let activeController;
let interrupted = false;
process.once('SIGINT', () => {
  interrupted = true;
  activeController?.abort(new DOMException('Evaluation canceled', 'AbortError'));
});
for (const [index, item] of selected.entries()) {
  if (index) await delay(2000);
  const controller = new AbortController();
  activeController = controller;
  const timeout = setTimeout(() => controller.abort(new DOMException("Evaluation deadline", "TimeoutError")), 570_000);
  const context = createExecutionContext(controller.signal);
	console.log(`\n=== Running: ${item.title} [${item.id}] ===`);
	const startedAt = Date.now();
	try {
		const writing = await rewriteText(item.request, undefined, context);
		const analysis = writing.analysis ?? await analyzeEeat(writing.text, item.request, context);
		const publication = assessPublicationReadiness({
			text: writing.text,
			analysis,
			writingReviewRequired: writing.quality.humanReviewRequired,
		});
		const finalLint = lintRequest(writing.text, item.request);

		// 1. Resilient Anchor Matching (Tolerates Farsi/Latin digit switch, whitespace & trailing slashes)
		const missingAnchors = item.anchors.filter(anchor => !containsAnchor(writing.text, anchor));

		// 2. Critical Forbidden Checks
		const forbiddenHits = item.forbidden
			.filter(pattern => pattern.test(writing.text))
			.map(pattern => pattern.source);

		// 3. Source Hedging Verification
		const sourceFlagged =
			!item.needsSource ||
			writing.text.includes('[[نیاز به منبع]]') ||
			Boolean(analysis?.unsourcedClaims?.length);

		// 4. Relaxed Markdown Hierarchy: No code fences, at most one H1 title
		const headingLevels = [...writing.text.matchAll(/^\s*(#{1,6})[ \t]+\S.*$/gm)].map(match => match[1].length);
		const h1Count = headingLevels.filter(level => level === 1).length;
		const noCodeFences = !/```(markdown)?/i.test(writing.text);
		const markdownReady = h1Count <= 1 && noCodeFences;

		// 5. Adaptive Lint Density Check (Tolerates minor warnings, rejects severe blocking density)
		const lintCategoryHits = (item.forbidLintCategories ?? []).filter(category =>
			finalLint.violations.some(v => v.category === category && v.severity === 'error'),
		);
		const maxDensity = item.maxFluffDensity ?? 0.15;
		const lintReady = finalLint.fluffDensity <= maxDensity && lintCategoryHits.length === 0;

		// 6. Editorial Signals (Soft warnings do not fail the pipeline unless high risk)
		const editorial = writing.quality.final.editorialSignals;
		const editorialReady = !editorial || (editorial.vagueAttributionHits === 0 && !editorial.symmetricList);

		const length = lengthAssessment(item.request, writing.text);
		const transformationPass =
			(length === null || length.passed) &&
			missingAnchors.length === 0 &&
			forbiddenHits.length === 0 &&
			sourceFlagged &&
			markdownReady &&
			lintReady &&
			editorialReady;

		const publicationReady = publication.status === 'ready-for-human-review' || publication.status === 'approved';
		const hardPass = transformationPass && publicationReady;
		const expectedPublication = item.needsSource ? 'blocked-for-sourcing' : 'ready-for-human-review';
		const acceptancePass = transformationPass && (item.needsSource
		  ? !publicationReady && publication.blockers.some(value => ['unsourced_claim', 'unresolved_placeholder'].includes(value))
		  : publicationReady);
		failed ||= !acceptancePass;

		writeFileSync(resolve(reportDir, `${item.id}.md`), writing.text);
		const result = { id: item.id, runId: context.runId, hardPass, acceptancePass, expectedPublication, transformationPass, publicationReady,
		  length, inputWords: countWords(item.request.text), outputWords: countWords(writing.text),
		  inputCharacters: item.request.text.length, usage: usageSummary(context.runId),
		  elapsedSeconds: (Date.now() - startedAt) / 1000, combinedReviewReused: writing.analysis !== null, combinedReviewEnabled: process.env.LLM_COMBINED_REVIEW !== 'false',
		  writerModel: process.env.LLM_WRITER_MODEL, criticModel: process.env.LLM_CRITIC_MODEL,
		  initial: writing.quality.initial, refinedIssueCodes: writing.quality.refinedIssueCodes,
		  issues: writing.quality.final.issues, warnings: writing.quality.warnings,
		  publication, missingAnchors, forbiddenHits };
		reports.push(result);
		console.log(writing.text);
		console.log(
			JSON.stringify(
				{
					acceptancePass,
					expectedPublication,
					usage: usageSummary(context.runId),
					length,
					hardPass,
					transformationPass,
					publicationReady,
					elapsedSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
					writingCalls: writing.quality.llmCalls,
					missingAnchors,
					forbiddenHits,
					sourceFlagged,
					markdownReady,
					lintReady,
					fluffDensity: finalLint.fluffDensity,
					lintCategoryHits,
					publicationStatus: publication.status,
					publicationBlockers: publication.blockers,
				},
				null,
				2,
			),
		);
	} catch (error) {
		failed = true;
		console.error(error instanceof Error ? error.message : String(error));
		reports.push({ id: item.id, runId: context.runId, hardPass: false,
		  error: error instanceof Error ? error.message : String(error), status: error.status,
		  usage: usageSummary(context.runId), elapsedSeconds: (Date.now() - startedAt) / 1000 });
		if (interrupted || [401, 402, 403, 429].includes(error.status)) { console.error('Stopping suite after account/provider restriction. Run npm run eval -- --diagnose.'); break; }
	} finally {
		clearTimeout(timeout);
		writeFileSync(resolve(reportDir, 'results.json'), JSON.stringify(reports, null, 2));
	}
}

process.exitCode = interrupted ? 130 : failed ? 1 : 0;
