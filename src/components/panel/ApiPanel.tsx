'use client';

import {
	CONTENT_TYPES,
	PERSPECTIVES,
	QUALITY_LEVELS,
	VOICES,
	type ContentType,
	type NarrativePerspective,
	type QualityLevel,
	type Voice,
} from '@/lib/types';
import { Check, Copy, Eye, EyeOff, LoaderCircle, Play, RefreshCw, Square } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* ---------- labels ---------- */

const VOICE_LABELS: Record<Voice, string> = {
	formal: 'اداری',
	standard: 'استاندارد',
	casual: 'خودمانی',
	roughcut: 'دم‌دستی',
};
const CONTENT_LABELS: Record<ContentType, string> = {
	general: 'عمومی',
	howto: 'آموزشی',
	commercial: 'تجاری',
	news: 'خبر',
	ymyl_health: 'سلامت',
	ymyl_money: 'مالی',
	ymyl_legal_civic: 'حقوقی/مدنی',
	opinion: 'دیدگاه',
};
const QUALITY_LABELS: Record<QualityLevel, string> = {
	simple: 'ساده',
	readable: 'خواندنی',
	precise: 'دقیق',
	strict: 'سخت‌گیر',
};
const PERSPECTIVE_LABELS: Record<NarrativePerspective, string> = {
	third_person: 'سوم‌شخص',
	first_person_singular: 'اول‌شخص (من)',
	first_person_plural: 'اول‌شخص (ما)',
};
const STAGE_LABELS: Record<string, string> = {
	invariants: 'استخراج نکات کلیدی',
	drafting: 'نگارش پیش‌نویس',
	validating: 'اعتبارسنجی',
	critic: 'بازبینی',
	refining: 'اصلاح نهایی',
};
const PUBLICATION_LABELS: Record<string, string> = {
	'ready-for-human-review': 'آماده برای بازبینی انسانی',
	'needs-work': 'نیاز به کار بیشتر',
	approved: 'تأیید شده',
	blocked: 'مسدود',
};
const BLOCKER_LABELS: Record<string, string> = {
	analysis_unavailable: 'تحلیل E-E-A-T در دسترس نبود',
	quality_review: 'نیاز به بازبینی کیفیت',
	eeat_gap: 'کمبود E-E-A-T',
	unsourced_claim: 'ادعای بدون منبع',
	unresolved_placeholder: 'جای‌خالی حل‌نشده',
};

const SAMPLE_TEXT =
	'در دنیای امروز، مطالعه کتاب یکی از مهم‌ترین عادت‌هایی است که می‌تواند زندگی ما را متحول کند. مطالعه منظم باعث افزایش دانش، بهبود تمرکز و تقویت مهارت‌های ارتباطی می‌شود. علاوه بر این، کتاب خواندن به ما کمک می‌کند تا دیدگاه‌های جدیدی پیدا کنیم و با فرهنگ‌های مختلف آشنا شویم. در نهایت، می‌توان گفت که مطالعه یک سرمایه‌گذاری ارزشمند برای آینده است.';

/* ---------- types ---------- */

interface Connection {
	apiKey: string | null;
	apiKeyCount: number;
	llmConfigured: boolean;
	models: Record<string, string> | null;
}
interface Health {
	ok: boolean;
	apiEnabled: boolean;
	llmConfigured: boolean;
	pendingJobs: number;
	slots: { active: number; waiting: number; max: number };
}
interface CheckModel {
	role: string;
	id: string;
	found: boolean;
	inputPerM?: number | null;
	outputPerM?: number | null;
	withinCap?: boolean | null;
}
interface CheckResult {
	ok: boolean;
	ready?: boolean;
	provider?: string;
	error?: string;
	key?: { checked: boolean; valid?: boolean; status?: number; usage?: number | null; limitRemaining?: number | null; limit?: number | null; error?: string };
	models?: CheckModel[];
	caps?: { input: number; output: number };
	catalogError?: string | null;
}
interface Step {
	stage: string;
	message: string;
	at: string;
}
interface RunState {
	phase: 'idle' | 'running' | 'done' | 'error' | 'canceled';
	mode: 'sync' | 'job';
	httpStatus?: number;
	jobId?: string;
	jobStatus?: string;
	steps: Step[];
	startedAt?: number;
	finishedAt?: number;
	response?: unknown;
}

type Mode = 'sync' | 'job';

/* ---------- helpers ---------- */

const ROLE_LABELS: Record<string, string> = { writer: 'نویسنده', critic: 'بازبین', refiner: 'اصلاح‌گر', fallback: 'جایگزین' };

function useCopy() {
	const [copied, setCopied] = useState<string | null>(null);
	const copy = useCallback(async (id: string, value: string) => {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(id);
			setTimeout(() => setCopied(current => (current === id ? null : current)), 1500);
		} catch {
			/* clipboard blocked: user can still select manually */
		}
	}, []);
	return { copied, copy };
}

function CopyBtn({ id, value, copied, copy, label = 'کپی' }: { id: string; value: string; copied: string | null; copy: (id: string, value: string) => void; label?: string }) {
	return (
		<button type='button' className='outline-button !min-h-9 !px-3 !text-xs' onClick={() => copy(id, value)} disabled={!value}>
			{copied === id ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
			{copied === id ? 'کپی شد' : label}
		</button>
	);
}

function StatusDot({ state }: { state: 'ok' | 'bad' | 'warn' | 'unknown' }) {
	const color = { ok: 'bg-green-500', bad: 'bg-red-500', warn: 'bg-amber-500', unknown: 'bg-ash' }[state];
	return <span className={`inline-block size-2.5 shrink-0 rounded-full ${color}`} aria-hidden />;
}

function Card({ kicker, title, children, actions }: { kicker: string; title: string; children: React.ReactNode; actions?: React.ReactNode }) {
	return (
		<section className='paper-panel p-5 sm:p-8'>
			<div className='mb-6 flex flex-wrap items-end justify-between gap-3'>
				<div>
					<span className='section-kicker !text-sm'>{kicker}</span>
					<h2 className='text-xl font-bold text-off-black sm:text-2xl'>{title}</h2>
				</div>
				{actions}
			</div>
			{children}
		</section>
	);
}

function formatSeconds(ms: number) {
	const seconds = Math.max(0, Math.round(ms / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/* ---------- main ---------- */

export default function ApiPanel() {
	const [origin, setOrigin] = useState('');
	const [connection, setConnection] = useState<Connection | null>(null);
	const [health, setHealth] = useState<Health | null>(null);
	const [check, setCheck] = useState<CheckResult | null>(null);
	const [checking, setChecking] = useState(false);
	const [showKey, setShowKey] = useState(false);
	const [apiKey, setApiKey] = useState('');
	const { copied, copy } = useCopy();

	const [text, setText] = useState(SAMPLE_TEXT);
	const [voice, setVoice] = useState<Voice>('standard');
	const [quality, setQuality] = useState<QualityLevel>('readable');
	const [contentType, setContentType] = useState<ContentType>('general');
	const [perspective, setPerspective] = useState<NarrativePerspective>('third_person');
	const [keywords, setKeywords] = useState('');
	const [targetWords, setTargetWords] = useState('');
	const [mode, setMode] = useState<Mode>('job');
	const [run, setRun] = useState<RunState>({ phase: 'idle', mode: 'job', steps: [] });
	const [now, setNow] = useState(0);
	const abortRef = useRef<AbortController | null>(null);
	const [snippetTab, setSnippetTab] = useState<'curl' | 'curl-job' | 'python' | 'js' | 'n8n'>('curl');

	const refreshHealth = useCallback(async () => {
		try {
			const res = await fetch('/api/v1/health', { cache: 'no-store' });
			setHealth(await res.json());
		} catch {
			setHealth(null);
		}
	}, []);

	useEffect(() => {
		let active = true;
		(async () => {
			const here = window.location.origin;
			try {
				const res = await fetch('/api/panel/connection', { cache: 'no-store', credentials: 'same-origin' });
				if (res.redirected || res.url.includes('/gate')) {
					window.location.replace('/gate?next=/panel');
					return;
				}
				const data = (await res.json()) as Connection;
				if (!active) return;
				setOrigin(here);
				setConnection(data);
				if (data.apiKey) setApiKey(data.apiKey);
			} catch {
				if (active) setOrigin(here);
			}
			if (active) await refreshHealth();
		})();
		return () => {
			active = false;
		};
	}, [refreshHealth]);

	useEffect(() => {
		if (run.phase !== 'running') return;
		const timer = setInterval(() => setNow(Date.now()), 500);
		return () => clearInterval(timer);
	}, [run.phase]);

	async function runCheck() {
		setChecking(true);
		try {
			const res = await fetch('/api/panel/check', { cache: 'no-store', credentials: 'same-origin' });
			setCheck(await res.json());
		} catch {
			setCheck({ ok: false, error: 'ارتباط با سرور برقرار نشد.' });
		}
		setChecking(false);
		void refreshHealth();
	}

	const body = useMemo(() => {
		const value: Record<string, unknown> = { text, voice, quality, contentType, perspective };
		const terms = keywords.split(/[,،\n]/).map(term => term.trim()).filter(Boolean);
		if (terms.length) value.keywords = terms;
		const target = Number(targetWords);
		if (targetWords.trim() && Number.isInteger(target)) value.targetWords = target;
		return value;
	}, [text, voice, quality, contentType, perspective, keywords, targetWords]);

	const authHeaders = useMemo(() => ({ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }), [apiKey]);

	async function pollJob(id: string, signal: AbortSignal) {
		while (!signal.aborted) {
			await new Promise(resolve => setTimeout(resolve, 3000));
			if (signal.aborted) return;
			let res: Response;
			try {
				res = await fetch(`/api/v1/jobs/${id}`, { headers: authHeaders, cache: 'no-store', signal });
			} catch {
				if (signal.aborted) return;
				continue; // transient network hiccup: keep polling
			}
			const data = await res.json();
			const finished = ['succeeded', 'failed', 'canceled'].includes(data.status) || !res.ok;
			setRun(current => ({
				...current,
				httpStatus: res.status,
				jobStatus: data.status,
				steps: data.steps ?? current.steps,
				response: data,
				...(finished && {
					phase: data.status === 'succeeded' ? 'done' : data.status === 'canceled' ? 'canceled' : 'error',
					finishedAt: Date.now(),
				}),
			}));
			if (finished) return;
		}
	}

	async function start() {
		if (!apiKey || !text.trim() || run.phase === 'running') return;
		const controller = new AbortController();
		abortRef.current = controller;
		const startedAt = Date.now();
		setNow(startedAt);
		setRun({ phase: 'running', mode, steps: [], startedAt });
		try {
			if (mode === 'sync') {
				const res = await fetch('/api/v1/humanize', { method: 'POST', headers: authHeaders, body: JSON.stringify(body), signal: controller.signal });
				const data = await res.json();
				setRun(current => ({ ...current, phase: res.ok ? 'done' : 'error', httpStatus: res.status, response: data, finishedAt: Date.now() }));
			} else {
				const res = await fetch('/api/v1/jobs', { method: 'POST', headers: authHeaders, body: JSON.stringify(body), signal: controller.signal });
				const data = await res.json();
				if (!res.ok) {
					setRun(current => ({ ...current, phase: 'error', httpStatus: res.status, response: data, finishedAt: Date.now() }));
					return;
				}
				setRun(current => ({ ...current, httpStatus: res.status, jobId: data.id, jobStatus: data.status, response: data }));
				await pollJob(data.id, controller.signal);
			}
		} catch {
			if (controller.signal.aborted) {
				setRun(current => ({ ...current, phase: 'canceled', finishedAt: Date.now() }));
			} else {
				setRun(current => ({ ...current, phase: 'error', finishedAt: Date.now(), response: { ok: false, error: { code: 'network', message: 'ارتباط با سرور قطع شد.' } } }));
			}
		} finally {
			void refreshHealth();
		}
	}

	async function cancel() {
		const jobId = run.jobId;
		abortRef.current?.abort();
		if (jobId) {
			try {
				await fetch(`/api/v1/jobs/${jobId}`, { method: 'DELETE', headers: authHeaders });
			} catch {
				/* ignore */
			}
		}
		setRun(current => ({ ...current, phase: 'canceled', jobStatus: jobId ? 'canceled' : current.jobStatus, finishedAt: Date.now() }));
		void refreshHealth();
	}

	/* ----- derived result ----- */
	const response = run.response as Record<string, unknown> | undefined;
	const result = (run.mode === 'job' ? (response?.result as Record<string, unknown> | undefined) : run.phase === 'done' ? response : undefined) ?? undefined;
	const resultText = typeof result?.text === 'string' ? result.text : '';
	const publication = result?.publication as { status: string; blockers: string[] } | undefined;
	const errorInfo = (response?.error as { code?: string; message?: string } | undefined) ?? undefined;
	const elapsed = run.startedAt ? (run.finishedAt ?? now) - run.startedAt : 0;
	const currentStep = run.steps[run.steps.length - 1];
	const details = result?.details as { quality?: { llmCalls?: number; criticVerdict?: string; refineRan?: boolean } } | undefined;

	/* ----- snippets ----- */
	const base = origin || 'https://YOUR-SERVICE.onrender.com';
	const keyForSnippet = showKey && apiKey ? apiKey : 'YOUR_API_KEY';
	const jsonBody = JSON.stringify(body, null, 2);
	const shellBody = jsonBody.replace(/'/g, "'\\''");
	const snippets: Record<typeof snippetTab, string> = {
		curl: `curl -X POST ${base}/api/v1/humanize \\
  -H "Authorization: Bearer ${keyForSnippet}" \\
  -H "Content-Type: application/json" \\
  --max-time 600 \\
  -d '${shellBody}'`,
		'curl-job': `# 1) ثبت کار
curl -X POST ${base}/api/v1/jobs \\
  -H "Authorization: Bearer ${keyForSnippet}" \\
  -H "Content-Type: application/json" \\
  -d '${shellBody}'

# 2) پیگیری (id را از پاسخ مرحلهٔ ۱ بردارید)
curl ${base}/api/v1/jobs/JOB_ID \\
  -H "Authorization: Bearer ${keyForSnippet}"`,
		python: `import time, requests

BASE = "${base}"
HEADERS = {"Authorization": "Bearer ${keyForSnippet}"}
payload = ${jsonBody.replace(/\n/g, '\n')}

job = requests.post(f"{BASE}/api/v1/jobs", json=payload, headers=HEADERS, timeout=30)
job.raise_for_status()
job_id = job.json()["id"]

while True:
    time.sleep(10)
    state = requests.get(f"{BASE}/api/v1/jobs/{job_id}", headers=HEADERS, timeout=30).json()
    if state["status"] == "succeeded":
        print(state["result"]["text"])
        break
    if state["status"] in ("failed", "canceled"):
        raise RuntimeError(state.get("error"))`,
		js: `const res = await fetch('${base}/api/v1/humanize', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ${keyForSnippet}',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(${jsonBody.replace(/\n/g, '\n  ')}),
  signal: AbortSignal.timeout(600_000),
});
const data = await res.json();
if (!data.ok) throw new Error(data.error.message);
console.log(data.text);`,
		n8n: `گره HTTP Request در n8n:

Method:          POST
URL:             ${base}/api/v1/humanize
Authentication:  Generic Credential Type → Header Auth
  Name:          Authorization
  Value:         Bearer ${keyForSnippet}
Send Body:       JSON
Body:            ${JSON.stringify(body)}
Options → Timeout: 600000

خروجی متن نهایی:  {{ $json.text }}

(برای گردش‌کارهای طولانی، از ‎/api/v1/jobs‎ + گره Wait + یک HTTP Request دوم برای پیگیری استفاده کنید.)`,
	};

	const apiReady = health?.apiEnabled && health?.llmConfigured;

	return (
		<div className='flex flex-col gap-6'>
			{/* ---------------- connection ---------------- */}
			<Card
				kicker='۱'
				title='اطلاعات اتصال'
				actions={
					<button type='button' className='outline-button' onClick={() => void refreshHealth()}>
						<RefreshCw size={16} aria-hidden /> به‌روزرسانی وضعیت
					</button>
				}
			>
				<div className='grid gap-4 md:grid-cols-2'>
					<div className='field-label'>
						آدرس پایهٔ API
						<div className='flex items-center gap-2'>
							<code dir='ltr' className='field flex-1 truncate !py-2.5 text-left font-mono text-xs leading-7'>
								{base}/api/v1
							</code>
							<CopyBtn id='base' value={`${base}/api/v1`} copied={copied} copy={copy} />
						</div>
					</div>
					<div className='field-label'>
						کلید API ({connection?.apiKeyCount ? `${connection.apiKeyCount.toLocaleString('fa-IR')} کلید تنظیم شده` : 'تنظیم نشده'})
						<div className='flex items-center gap-2'>
							<input
								dir='ltr'
								className='field min-w-0 flex-1 !py-2.5 font-mono text-xs'
								type={showKey ? 'text' : 'password'}
								value={apiKey}
								onChange={event => setApiKey(event.target.value)}
								placeholder='NEGARESH_API_KEY'
								autoComplete='off'
								spellCheck={false}
								aria-label='کلید API'
							/>
							<button type='button' className='outline-button !min-h-9 !px-3' onClick={() => setShowKey(value => !value)} aria-label={showKey ? 'پنهان کردن کلید' : 'نمایش کلید'}>
								{showKey ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
							</button>
							<CopyBtn id='key' value={apiKey} copied={copied} copy={copy} />
						</div>
					</div>
				</div>

				<div className='mt-6 grid gap-3 sm:grid-cols-3'>
					<div className='flex items-center gap-2 rounded-[20px] border border-ash bg-parchment px-4 py-3 text-sm'>
						<StatusDot state={health ? (health.apiEnabled ? 'ok' : 'bad') : 'unknown'} />
						API {health ? (health.apiEnabled ? 'فعال است' : 'غیرفعال (NEGARESH_API_KEY)') : '…'}
					</div>
					<div className='flex items-center gap-2 rounded-[20px] border border-ash bg-parchment px-4 py-3 text-sm'>
						<StatusDot state={health ? (health.llmConfigured ? 'ok' : 'bad') : 'unknown'} />
						کلید اوپن‌روتر {health ? (health.llmConfigured ? 'تنظیم شده' : 'تنظیم نشده (API_KEY)') : '…'}
					</div>
					<div className='flex items-center gap-2 rounded-[20px] border border-ash bg-parchment px-4 py-3 text-sm'>
						<StatusDot state={health ? 'ok' : 'unknown'} />
						{health ? (
							<span className='flex flex-wrap gap-x-3'>
								<span>
									در حال پردازش <bdi>{health.slots.active.toLocaleString('fa-IR')}</bdi> از{' '}
									<bdi>{health.slots.max.toLocaleString('fa-IR')}</bdi>
								</span>
								<span className='text-smoke'>
									در صف <bdi>{health.slots.waiting.toLocaleString('fa-IR')}</bdi>
								</span>
							</span>
						) : (
							'…'
						)}
					</div>
				</div>

				{/* OpenRouter diagnostics */}
				<div className='mt-6 rounded-[24px] border border-ash bg-parchment p-4 sm:p-5'>
					<div className='flex flex-wrap items-center justify-between gap-3'>
						<div>
							<p className='font-medium text-off-black'>بررسی اتصال به اوپن‌روتر</p>
							<p className='text-xs leading-6 text-smoke'>اعتبار کلید، اعتبار باقی‌مانده، وجود مدل‌ها و سقف قیمت را چک می‌کند (بدون مصرف اعتبار).</p>
						</div>
						<button type='button' className='secondary-button !min-h-11 !px-5' onClick={() => void runCheck()} disabled={checking}>
							{checking ? <LoaderCircle size={16} className='animate-spin' aria-hidden /> : <RefreshCw size={16} aria-hidden />}
							{checking ? 'در حال بررسی' : 'بررسی کن'}
						</button>
					</div>

					{check && (
						<div className='mt-4 flex flex-col gap-3 text-sm' aria-live='polite'>
							{check.error && <p className='text-error-ink'>{check.error}</p>}
							{check.ok && (
								<>
									<p className='flex items-center gap-2 font-medium'>
										<StatusDot state={check.ready ? 'ok' : 'bad'} />
										{check.ready ? 'همه چیز آماده است.' : 'یک یا چند مورد نیاز به اصلاح دارد.'}
									</p>
									{check.key?.checked && (
										<p className='flex items-center gap-2'>
											<StatusDot state={check.key.valid ? 'ok' : 'bad'} />
											{check.key.valid
												? `کلید اوپن‌روتر معتبر است${typeof check.key.limitRemaining === 'number' ? ` · اعتبار باقی‌مانده: $${check.key.limitRemaining.toFixed(2)}` : ''}${typeof check.key.usage === 'number' ? ` · مصرف تا امروز: $${check.key.usage.toFixed(2)}` : ''}`
												: `کلید اوپن‌روتر نامعتبر است${check.key.status ? ` (HTTP ${check.key.status})` : ''}${check.key.error ? ` — ${check.key.error}` : ''}`}
										</p>
									)}
									{check.catalogError && <p className='text-error-ink'>فهرست مدل‌ها دریافت نشد: {check.catalogError}</p>}
									{!!check.models?.length && (
										<div className='overflow-x-auto'>
											<table className='w-full min-w-[520px] text-right text-xs'>
												<thead className='text-smoke'>
													<tr>
														<th className='py-2 font-normal'>نقش</th>
														<th className='py-2 font-normal'>مدل</th>
														<th className='py-2 font-normal'>قیمت ورودی / خروجی ($ در ۱M توکن)</th>
														<th className='py-2 font-normal'>وضعیت</th>
													</tr>
												</thead>
												<tbody>
													{check.models.map(model => (
														<tr key={model.role} className='border-t border-ash'>
															<td className='py-2'>{ROLE_LABELS[model.role] ?? model.role}</td>
															<td className='py-2 font-mono' dir='ltr'>{model.id}</td>
															<td className='py-2 font-mono' dir='ltr'>
																{model.found ? `${model.inputPerM ?? '?'} / ${model.outputPerM ?? '?'}` : '—'}
															</td>
															<td className='py-2'>
																<span className='flex items-center gap-1.5'>
																	<StatusDot state={!model.found ? 'bad' : model.withinCap === false ? 'warn' : 'ok'} />
																	{!model.found ? 'در اوپن‌روتر پیدا نشد' : model.withinCap === false ? 'گران‌تر از سقف قیمت' : 'آماده'}
																</span>
															</td>
														</tr>
													))}
												</tbody>
											</table>
											{check.caps && (
												<p className='mt-2 text-xs leading-6 text-smoke'>
													سقف فعلی: ورودی ${check.caps.input} و خروجی ${check.caps.output} در هر میلیون توکن (متغیرهای LLM_MAX_INPUT_PRICE و LLM_MAX_OUTPUT_PRICE).
												</p>
											)}
										</div>
									)}
								</>
							)}
						</div>
					)}
				</div>
			</Card>

			{/* ---------------- test ---------------- */}
			<Card kicker='۲' title='تست زنده'>
				<div className='grid gap-6 lg:grid-cols-2'>
					<div className='flex flex-col gap-4'>
						<label className='field-label'>
							متن ورودی
							<textarea
								className='field min-h-56 resize-y leading-8'
								value={text}
								onChange={event => setText(event.target.value)}
								dir='rtl'
							/>
							<span className='text-xs font-normal text-smoke'>{text.length.toLocaleString('fa-IR')} نویسه</span>
						</label>
						<div className='grid grid-cols-2 gap-3'>
							<label className='field-label'>
								لحن (voice)
								<select className='field' value={voice} onChange={event => setVoice(event.target.value as Voice)}>
									{VOICES.map(value => (
										<option key={value} value={value}>{VOICE_LABELS[value]}</option>
									))}
								</select>
							</label>
							<label className='field-label'>
								سطح کیفیت (quality)
								<select className='field' value={quality} onChange={event => setQuality(event.target.value as QualityLevel)}>
									{QUALITY_LEVELS.map(value => (
										<option key={value} value={value}>{QUALITY_LABELS[value]}</option>
									))}
								</select>
							</label>
							<label className='field-label'>
								نوع محتوا (contentType)
								<select className='field' value={contentType} onChange={event => setContentType(event.target.value as ContentType)}>
									{CONTENT_TYPES.map(value => (
										<option key={value} value={value}>{CONTENT_LABELS[value]}</option>
									))}
								</select>
							</label>
							<label className='field-label'>
								زاویه دید (perspective)
								<select className='field' value={perspective} onChange={event => setPerspective(event.target.value as NarrativePerspective)}>
									{PERSPECTIVES.map(value => (
										<option key={value} value={value}>{PERSPECTIVE_LABELS[value]}</option>
									))}
								</select>
							</label>
							<label className='field-label'>
								کلیدواژه‌ها (اختیاری)
								<input className='field' value={keywords} onChange={event => setKeywords(event.target.value)} placeholder='با کاما جدا کنید' />
							</label>
							<label className='field-label'>
								تعداد کلمات هدف (اختیاری)
								<input className='field' inputMode='numeric' dir='ltr' value={targetWords} onChange={event => setTargetWords(event.target.value.replace(/[^\d۰-۹]/g, '').replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))))} placeholder='100 – 3000' />
							</label>
						</div>

						<div className='flex flex-wrap items-center gap-2' role='group' aria-label='حالت درخواست'>
							<span className='text-sm text-graphite'>حالت:</span>
							<button type='button' className='choice-button' aria-pressed={mode === 'job'} onClick={() => setMode('job')} disabled={run.phase === 'running'}>
								دو مرحله‌ای (jobs)
							</button>
							<button type='button' className='choice-button' aria-pressed={mode === 'sync'} onClick={() => setMode('sync')} disabled={run.phase === 'running'}>
								همزمان (humanize)
							</button>
						</div>

						<div className='flex flex-wrap gap-3'>
							{run.phase === 'running' ? (
								<button type='button' className='secondary-button' onClick={() => void cancel()}>
									<Square size={16} aria-hidden /> لغو
								</button>
							) : (
								<button type='button' className='primary-button' onClick={() => void start()} disabled={!apiKey || !text.trim() || !apiReady}>
									<Play size={16} aria-hidden /> ارسال درخواست
								</button>
							)}
						</div>
						{!apiKey && <p className='text-xs text-error-ink'>کلید API را در بخش ۱ وارد کنید.</p>}
						{health && !apiReady && <p className='text-xs text-error-ink'>API یا کلید اوپن‌روتر روی سرور تنظیم نشده است.</p>}
					</div>

					{/* result */}
					<div className='flex min-w-0 flex-col gap-4'>
						<div className='rounded-[24px] border border-ash bg-parchment p-4 text-sm' aria-live='polite'>
							{run.phase === 'idle' && <p className='text-smoke'>نتیجه اینجا نمایش داده می‌شود. پردازش معمولاً ۱ تا چند دقیقه طول می‌کشد.</p>}
							{run.phase !== 'idle' && (
								<div className='flex flex-col gap-2'>
									<p className='flex flex-wrap items-center gap-x-3 gap-y-1'>
										{run.phase === 'running' && <LoaderCircle size={16} className='animate-spin text-lake-blue' aria-hidden />}
										<StatusDot state={run.phase === 'done' ? 'ok' : run.phase === 'running' ? 'warn' : run.phase === 'canceled' ? 'unknown' : 'bad'} />
										<span className='font-medium'>
											{{ running: 'در حال پردازش', done: 'انجام شد', error: 'ناموفق', canceled: 'لغو شد', idle: '' }[run.phase]}
										</span>
										<span className='font-mono text-xs text-smoke' dir='ltr'>{formatSeconds(elapsed)}</span>
										{run.httpStatus && <span className='font-mono text-xs text-smoke' dir='ltr'>HTTP {run.httpStatus}</span>}
										{run.jobStatus && <span className='font-mono text-xs text-smoke' dir='ltr'>job: {run.jobStatus}</span>}
									</p>
									{run.phase === 'running' && run.mode === 'sync' && <p className='text-xs text-smoke'>در حالت همزمان، مراحل میانی نمایش داده نمی‌شود؛ پاسخ در پایان کار برمی‌گردد.</p>}
									{run.steps.length > 0 && (
										<ol className='mt-1 flex flex-col gap-1 text-xs'>
											{run.steps.map((step, index) => (
												<li key={`${step.at}-${index}`} className={step === currentStep && run.phase === 'running' ? 'font-medium text-off-black' : 'text-smoke'}>
													{STAGE_LABELS[step.stage] ?? step.stage}
													{step.message ? ` — ${step.message}` : ''}
												</li>
											))}
										</ol>
									)}
									{errorInfo && (
										<p className='text-error-ink'>
											<span className='font-mono text-xs' dir='ltr'>{errorInfo.code}</span> — {errorInfo.message}
										</p>
									)}
								</div>
							)}
						</div>

						{resultText && (
							<div className='flex flex-col gap-3'>
								<div className='flex flex-wrap items-center justify-between gap-2'>
									<p className='font-medium text-off-black'>متن نهایی</p>
									<CopyBtn id='result' value={resultText} copied={copied} copy={copy} label='کپی متن' />
								</div>
								<div className='editor-result max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded-[24px] border border-ash bg-card p-5 text-sm leading-8' dir='rtl'>
									{resultText}
								</div>
								<div className='flex flex-wrap gap-2 text-xs'>
									{publication && (
										<span className='rounded-full border border-ash bg-parchment px-3 py-1'>
											{PUBLICATION_LABELS[publication.status] ?? publication.status}
										</span>
									)}
									{publication?.blockers?.map(blocker => (
										<span key={blocker} className='rounded-full bg-review-wash px-3 py-1 text-error-ink'>
											{BLOCKER_LABELS[blocker] ?? blocker}
										</span>
									))}
									{typeof details?.quality?.llmCalls === 'number' && (
										<span className='rounded-full border border-ash px-3 py-1 text-smoke'>
											{details.quality.llmCalls.toLocaleString('fa-IR')} فراخوانی مدل
										</span>
									)}
								</div>
								{typeof result?.warning === 'string' && <p className='text-xs leading-6 text-graphite'>⚠ {result.warning}</p>}
							</div>
						)}

						{response !== undefined && (
							<details className='rounded-[20px] border border-ash bg-card p-4 text-xs'>
								<summary className='font-medium'>پاسخ خام JSON</summary>
								<pre dir='ltr' className='mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-left font-mono leading-5'>
									{JSON.stringify(response, null, 2)}
								</pre>
							</details>
						)}
					</div>
				</div>
			</Card>

			{/* ---------------- snippets ---------------- */}
			<Card
				kicker='۳'
				title='نمونه کد اتصال'
				actions={<CopyBtn id='snippet' value={snippets[snippetTab]} copied={copied} copy={copy} label='کپی کد' />}
			>
				<p className='mb-4 text-sm leading-7 text-graphite'>
					این کدها از تنظیمات بخش «تست زنده» ساخته می‌شوند.
					{!showKey && ' برای قرار گرفتن کلید واقعی در کد، دکمهٔ نمایش کلید را بزنید.'}
				</p>
				<div className='mb-3 flex flex-wrap gap-1' role='group' aria-label='زبان نمونه کد'>
					{(
						[
							['curl', 'cURL (همزمان)'],
							['curl-job', 'cURL (دو مرحله‌ای)'],
							['python', 'Python'],
							['js', 'JavaScript'],
							['n8n', 'n8n'],
						] as const
					).map(([id, label]) => (
						<button key={id} type='button' aria-pressed={snippetTab === id} className='choice-button' onClick={() => setSnippetTab(id)}>
							{label}
						</button>
					))}
				</div>
				<pre dir='ltr' className='max-h-[32rem] overflow-auto rounded-[24px] bg-off-black p-5 text-left font-mono text-xs leading-6 text-parchment'>
					{snippets[snippetTab]}
				</pre>
			</Card>
		</div>
	);
}
