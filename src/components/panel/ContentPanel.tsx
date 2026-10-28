'use client';

import type { ContentResult } from '@/lib/content/pipeline';
import CampaignsCard from './CampaignsCard';
import { markdownToSafeHtml } from '@/lib/markdown-renderer';
import { Check, Copy, Download, ExternalLink, Eye, LoaderCircle, Play, Plus, RefreshCw, Search, Square, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* ---------- types ---------- */

type QaLevel = 'pass' | 'warn' | 'fail';
type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

interface ContentConfig {
	models: { brief: string; draft: string; draftOptions: string[] };
	promptVersion: string;
	tiers: Record<string, { min: number; max: number }>;
	stats: { categories: number; withProducts: number; l1Profiles: number; l2Profiles: number };
}
interface CategoryItem {
	id: string;
	name: string;
	level: number;
	products: number;
	tier: string;
	path: string;
	profiles: { l1: boolean; l2: boolean };
	flags: string | null;
}
interface Selected {
	key: string;
	name: string;
	path?: string;
	raw?: boolean;
}
interface ContentJob {
	id: string;
	status: JobStatus;
	meta: { categoryId?: string; categoryName?: string; draftModel?: string | null; humanize?: boolean; label?: string | null };
	currentStep: { stage: string; message: string; at: string } | null;
	createdAt: string;
	finishedAt?: string;
	resultId?: string;
	qa?: QaLevel;
	costUsd?: number | null;
	error?: string;
}
type Tab = 'preview' | 'compare' | 'qa' | 'brief';

/* ---------- labels ---------- */

const TIER_LABELS: Record<string, string> = { hub: 'هاب', standard: 'استاندارد', small: 'کوچک', skip: 'رد شده' };
const STATUS_LABELS: Record<JobStatus, string> = {
	queued: 'در صف',
	running: 'در حال اجرا',
	succeeded: 'انجام شد',
	failed: 'ناموفق',
	canceled: 'لغو شد',
};
const QA_LABELS: Record<QaLevel, string> = { pass: 'قبول', warn: 'بررسی', fail: 'رد' };
const QA_CLASSES: Record<QaLevel, string> = {
	pass: 'bg-green-100 text-green-800',
	warn: 'bg-amber-100 text-amber-800',
	fail: 'bg-red-100 text-red-800',
};
const AUDIENCE_LABELS: Record<string, string> = { B2B: 'سازمانی (B2B)', B2C: 'مصرف‌کننده (B2C)', mixed: 'ترکیبی' };
const FORMAT_LABELS: Record<string, string> = { paragraph: 'پاراگراف', bullets: 'فهرست', table: 'جدول' };
const TABS: Array<[Tab, string]> = [
	['preview', 'پیش‌نمایش'],
	['compare', 'مقایسه هیومنایز'],
	['qa', 'کنترل کیفیت'],
	['brief', 'بریف و داده'],
];

/* ---------- helpers ---------- */

const fa = (value: number) => value.toLocaleString('fa-IR');
const usd = (value: number | null | undefined) => (typeof value === 'number' ? `$${value.toFixed(value < 1 ? 3 : 2)}` : '—');
const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);
const isActive = (job: ContentJob) => job.status === 'queued' || job.status === 'running';

interface SavedSummary {
	resultId: string;
	createdAt: string;
	label: string | null;
	category: { id: string; name: string; tier: string; productCount: number };
	models: { brief: string; draft: string; humanize: boolean };
	qa: QaLevel;
	words: number;
	costUsd: number | null;
	durationMs: number;
}

function formatDuration(ms: number) {
	const seconds = Math.max(0, Math.round(ms / 1000));
	return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function formatTime(iso: string) {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
}
function formatDateTime(iso: string) {
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('fa-IR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function safeHtml(markdown: string | undefined) {
	try {
		return markdownToSafeHtml(markdown ?? '');
	} catch {
		return '';
	}
}
function errorMessage(data: unknown, fallback: string) {
	const error = (data as { error?: { code?: string; message?: string } | string } | null)?.error;
	if (typeof error === 'string') return error;
	return error?.message ?? fallback;
}

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

const qaDot = (level: QaLevel | undefined) => (level === 'pass' ? 'ok' : level === 'warn' ? 'warn' : level === 'fail' ? 'bad' : 'unknown');

function QaBadge({ level }: { level?: QaLevel }) {
	if (!level) return <span className='text-smoke'>—</span>;
	return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${QA_CLASSES[level]}`}>{QA_LABELS[level]}</span>;
}

function Chip({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'blue' | 'warn' }) {
	const cls = { plain: 'border border-ash bg-parchment text-graphite', blue: 'bg-periwinkle text-lake-blue', warn: 'bg-review-wash text-error-ink' }[tone];
	return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs ${cls}`}>{children}</span>;
}

function Card({ kicker, title, children, actions }: { kicker: string; title: string; children: React.ReactNode; actions?: React.ReactNode }) {
	return (
		<section className='paper-panel min-w-0 p-5 sm:p-8'>
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

function Block({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className='rounded-[20px] border border-ash bg-parchment p-4'>
			<p className='mb-2 text-sm font-medium text-off-black'>{title}</p>
			<div className='text-sm leading-7 text-graphite'>{children}</div>
		</div>
	);
}

function Markdown({ html }: { html: string }) {
	return <article dir='rtl' className='markdown-output prose prose-neutral max-w-none text-right' dangerouslySetInnerHTML={{ __html: html }} />;
}

/* ---------- main ---------- */

export default function ContentPanel() {
	const [apiKey, setApiKey] = useState('');
	const [connError, setConnError] = useState('');
	const [config, setConfig] = useState<ContentConfig | null>(null);
	const { copied, copy } = useCopy();

	const [query, setQuery] = useState('');
	const [searching, setSearching] = useState(false);
	const [items, setItems] = useState<CategoryItem[]>([]);
	const [selected, setSelected] = useState<Selected[]>([]);
	const [pasted, setPasted] = useState('');

	const [draftModel, setDraftModel] = useState('');
	const [humanize, setHumanize] = useState(true);
	const [label, setLabel] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState('');

	const [jobs, setJobs] = useState<ContentJob[]>([]);
	const [jobsError, setJobsError] = useState('');
	const [now, setNow] = useState(0);
	const [ioBusy, setIoBusy] = useState(false);
	const [ioMessage, setIoMessage] = useState('');
	const fileRef = useRef<HTMLInputElement>(null);

	const [saved, setSaved] = useState<SavedSummary[]>([]);
	const [savedLabel, setSavedLabel] = useState('');
	const [result, setResult] = useState<ContentResult | null>(null);
	const [resultLoading, setResultLoading] = useState<string | null>(null);
	const [resultError, setResultError] = useState('');
	const [tab, setTab] = useState<Tab>('preview');
	const viewerRef = useRef<HTMLDivElement>(null);

	const headers = useMemo(() => ({ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }), [apiKey]);

	/* ----- connection + config ----- */
	useEffect(() => {
		let active = true;
		(async () => {
			try {
				const res = await fetch('/api/panel/connection', { cache: 'no-store', credentials: 'same-origin' });
				if (res.redirected || res.url.includes('/gate')) {
					window.location.replace('/gate?next=/panel/content');
					return;
				}
				const data = (await res.json()) as { apiKey: string | null };
				if (!active) return;
				if (!data.apiKey) {
					setConnError('کلید API روی سرور تنظیم نشده است (NEGARESH_API_KEY).');
					return;
				}
				setApiKey(data.apiKey);
				const cfgRes = await fetch('/api/v1/content/config', { cache: 'no-store', headers: { Authorization: `Bearer ${data.apiKey}` } });
				const cfg = await cfgRes.json();
				if (!active) return;
				if (!cfgRes.ok) {
					setConnError(errorMessage(cfg, 'تنظیمات تولید محتوا دریافت نشد.'));
					return;
				}
				setConfig(cfg as ContentConfig);
				setDraftModel((cfg as ContentConfig).models.draft);
			} catch {
				if (active) setConnError('ارتباط با سرور برقرار نشد.');
			}
		})();
		return () => {
			active = false;
		};
	}, []);

	/* ----- debounced category search ----- */
	useEffect(() => {
		if (!apiKey) return;
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			setSearching(true);
			try {
				const res = await fetch(`/api/v1/content/categories?q=${encodeURIComponent(query.trim())}&limit=30`, { headers, cache: 'no-store', signal: controller.signal });
				const data = await res.json();
				setItems(res.ok ? ((data.items ?? []) as CategoryItem[]) : []);
			} catch {
				if (!controller.signal.aborted) setItems([]);
			}
			if (!controller.signal.aborted) setSearching(false);
		}, 300);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	}, [apiKey, headers, query]);

	/* ----- jobs ----- */
	const refreshJobs = useCallback(async () => {
		if (!apiKey) return;
		try {
			const res = await fetch('/api/v1/content/jobs', { headers, cache: 'no-store' });
			const data = await res.json();
			if (!res.ok) {
				setJobsError(errorMessage(data, 'فهرست کارها دریافت نشد.'));
				return;
			}
			setJobsError('');
			setJobs((data.jobs ?? []) as ContentJob[]);
			setNow(Date.now());
		} catch {
			setJobsError('ارتباط با سرور برقرار نشد.');
		}
	}, [apiKey, headers]);

	useEffect(() => {
		if (!apiKey) return;
		const timer = setTimeout(() => void refreshJobs(), 0);
		return () => clearTimeout(timer);
	}, [apiKey, refreshJobs]);

	const anyActive = jobs.some(isActive);
	useEffect(() => {
		if (!anyActive) return;
		const timer = setInterval(() => void refreshJobs(), 4000);
		const tick = setInterval(() => setNow(Date.now()), 1000);
		return () => {
			clearInterval(timer);
			clearInterval(tick);
		};
	}, [anyActive, refreshJobs]);

	/* ----- saved results (persistent store) ----- */
	const refreshSaved = useCallback(async () => {
		if (!apiKey) return;
		try {
			const res = await fetch('/api/v1/content/results', { headers, cache: 'no-store' });
			const data = await res.json();
			if (res.ok) setSaved((data.items ?? []) as SavedSummary[]);
		} catch {
			/* keep previous list */
		}
	}, [apiKey, headers]);

	const succeededCount = jobs.filter(j => j.status === 'succeeded').length;
	useEffect(() => {
		if (!apiKey) return;
		const timer = setTimeout(() => void refreshSaved(), 0);
		return () => clearTimeout(timer);
	}, [apiKey, refreshSaved, succeededCount]);

	const savedLabels = useMemo(() => [...new Set(saved.map(r => r.label ?? ''))], [saved]);
	const savedVisible = useMemo(() => saved.filter(r => !savedLabel || (r.label ?? '') === savedLabel), [saved, savedLabel]);

	/* ----- selection ----- */
	const selectedKeys = useMemo(() => new Set(selected.map(item => item.key)), [selected]);

	function toggleCategory(item: CategoryItem) {
		setSelected(current =>
			current.some(entry => entry.key === item.id) ? current.filter(entry => entry.key !== item.id) : [...current, { key: item.id, name: item.name, path: item.path }],
		);
	}
	function addPasted() {
		const lines = pasted.split('\n').map(line => line.trim()).filter(Boolean);
		if (!lines.length) return;
		setSelected(current => {
			const keys = new Set(current.map(entry => entry.key));
			const added = lines.filter(line => !keys.has(line) && keys.add(line)).map(line => ({ key: line, name: line, raw: true }));
			return [...current, ...added];
		});
		setPasted('');
	}

	async function submit() {
		if (!selected.length || submitting) return;
		setSubmitting(true);
		setSubmitError('');
		try {
			const body: Record<string, unknown> = { categories: selected.map(item => item.key), humanize };
			if (draftModel) body.draftModel = draftModel;
			if (label.trim()) body.label = label.trim();
			const res = await fetch('/api/v1/content/jobs', { method: 'POST', headers, body: JSON.stringify(body) });
			const data = await res.json();
			if (!res.ok) {
				setSubmitError(errorMessage(data, `ثبت کار ناموفق بود (HTTP ${res.status}).`));
			} else {
				setSelected([]);
				await refreshJobs();
			}
		} catch {
			setSubmitError('ارتباط با سرور برقرار نشد.');
		}
		setSubmitting(false);
	}

	async function cancelJob(id: string) {
		try {
			await fetch(`/api/v1/jobs/${id}`, { method: 'DELETE', headers });
		} catch {
			/* ignore */
		}
		void refreshJobs();
	}

	async function openResult(resultId: string) {
		setResultLoading(resultId);
		setResultError('');
		try {
			const res = await fetch(`/api/v1/content/results/${encodeURIComponent(resultId)}`, { headers, cache: 'no-store' });
			const data = await res.json();
			if (!res.ok) {
				setResultError(errorMessage(data, 'نتیجه دریافت نشد.'));
			} else {
				setResult(data.result as ContentResult);
				setTab('preview');
				setTimeout(() => viewerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
			}
		} catch {
			setResultError('ارتباط با سرور برقرار نشد.');
		}
		setResultLoading(null);
	}

	/* ----- export / import ----- */
	async function exportAll() {
		setIoBusy(true);
		setIoMessage('');
		try {
			const res = await fetch('/api/v1/content/results?full=1', { headers, cache: 'no-store' });
			if (!res.ok) {
				setIoMessage(errorMessage(await res.json().catch(() => null), 'دریافت خروجی ناموفق بود.'));
			} else {
				const blob = await res.blob();
				const url = URL.createObjectURL(blob);
				const anchor = document.createElement('a');
				anchor.href = url;
				anchor.download = `negaresh-content-${new Date().toISOString().slice(0, 10)}.json`;
				anchor.click();
				setTimeout(() => URL.revokeObjectURL(url), 1000);
			}
		} catch {
			setIoMessage('ارتباط با سرور برقرار نشد.');
		}
		setIoBusy(false);
	}

	async function importFile(file: File) {
		setIoBusy(true);
		setIoMessage('');
		try {
			const parsed = JSON.parse(await file.text()) as unknown;
			const list = Array.isArray(parsed) ? parsed : (parsed as { items?: unknown[] })?.items;
			if (!Array.isArray(list)) {
				setIoMessage('فایل معتبر نیست: فهرست items پیدا نشد.');
			} else {
				const res = await fetch('/api/v1/content/results/import', { method: 'POST', headers, body: JSON.stringify({ items: list }) });
				const data = await res.json();
				setIoMessage(res.ok ? `${fa(Number(data.imported) || 0)} نتیجه بارگذاری شد.` : errorMessage(data, 'بارگذاری ناموفق بود.'));
			}
		} catch {
			setIoMessage('فایل JSON خوانده نشد.');
		}
		if (fileRef.current) fileRef.current.value = '';
		setIoBusy(false);
	}

	/* ----- derived result html ----- */
	const belowHtml = useMemo(() => safeHtml(result?.content.below), [result]);
	const draftHtml = useMemo(() => safeHtml(result?.draftBelow), [result]);
	const ready = !!apiKey && !!config;

	return (
		<div className='flex min-w-0 flex-col gap-6'>
			{connError && (
				<p className='rounded-[20px] bg-review-wash px-4 py-3 text-sm text-error-ink' role='alert'>
					{connError}
				</p>
			)}

			{config && (
				<div className='grid gap-3 sm:grid-cols-4'>
					{(
						[
							['کل دسته‌ها', config.stats.categories],
							['دسته‌های دارای محصول', config.stats.withProducts],
							['پروفایل سطح ۱', config.stats.l1Profiles],
							['پروفایل اختصاصی (سطح ۲)', config.stats.l2Profiles],
						] as const
					).map(([title, value]) => (
						<div key={title} className='rounded-[20px] border border-ash bg-parchment px-4 py-3 text-sm'>
							<p className='text-xs text-smoke'>{title}</p>
							<p className='mt-1 text-lg font-bold text-off-black'>{fa(value)}</p>
						</div>
					))}
				</div>
			)}

			{/* ---------------- 1. selection ---------------- */}
			<Card kicker='۱' title='انتخاب دسته'>
				<div className='grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'>
					<div className='flex min-w-0 flex-col gap-3'>
						<label className='field-label'>
							جستجوی دسته
							<span className='relative block'>
								<Search size={16} className='pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-smoke' aria-hidden />
								<input
									className='field w-full !pr-11'
									value={query}
									onChange={event => setQuery(event.target.value)}
									placeholder='مثلاً کنتاکتور، شیر برقی، بلبرینگ…'
									disabled={!apiKey}
								/>
							</span>
						</label>
						<div className='max-h-[26rem] overflow-y-auto rounded-[20px] border border-ash bg-card' aria-busy={searching}>
							{searching && !items.length && (
								<p className='flex items-center gap-2 p-4 text-sm text-smoke'>
									<LoaderCircle size={16} className='animate-spin' aria-hidden /> در حال جستجو…
								</p>
							)}
							{!searching && !items.length && <p className='p-4 text-sm text-smoke'>{apiKey ? 'دسته‌ای پیدا نشد.' : '…'}</p>}
							<ul>
								{items.map(item => {
									const isSelected = selectedKeys.has(item.id);
									return (
										<li key={item.id} className='border-b border-ash last:border-b-0'>
											<button
												type='button'
												onClick={() => toggleCategory(item)}
												aria-pressed={isSelected}
												className={`flex w-full items-start gap-3 px-4 py-3 text-right transition-colors hover:bg-parchment ${isSelected ? 'bg-periwinkle/40' : ''}`}
											>
												<span className={`mt-1 flex size-5 shrink-0 items-center justify-center rounded-md border ${isSelected ? 'border-lake-blue bg-lake-blue text-white' : 'border-field-border'}`}>
													{isSelected && <Check size={13} aria-hidden />}
												</span>
												<span className='min-w-0 flex-1'>
													<span className='flex flex-wrap items-center gap-1.5'>
														<span className='font-medium text-off-black'>{item.name}</span>
														<Chip>{TIER_LABELS[item.tier] ?? item.tier}</Chip>
														{item.profiles.l2 && <Chip tone='blue'>پروفایل اختصاصی</Chip>}
													</span>
													<span className='mt-0.5 block truncate text-xs text-smoke'>{item.path}</span>
												</span>
												<span className='shrink-0 text-xs text-graphite'>
													<bdi>{fa(item.products)}</bdi> محصول
												</span>
											</button>
										</li>
									);
								})}
							</ul>
						</div>
						<label className='field-label'>
							افزودن دستی (هر خط یک شناسه، نامک، آدرس یا نام دقیق)
							<textarea className='field min-h-24 resize-y font-mono text-xs leading-6' dir='auto' value={pasted} onChange={event => setPasted(event.target.value)} placeholder={'1234\nhttps://example.com/product-category/…'} />
						</label>
						<div>
							<button type='button' className='outline-button' onClick={addPasted} disabled={!pasted.trim()}>
								<Plus size={16} aria-hidden /> افزودن به صف
							</button>
						</div>
					</div>

					<div className='flex min-w-0 flex-col gap-3'>
						<div className='flex items-center justify-between gap-2'>
							<p className='font-medium text-off-black'>
								صف انتخاب‌شده <span className='text-sm text-smoke'>({fa(selected.length)})</span>
							</p>
							{selected.length > 0 && (
								<button type='button' className='text-xs text-smoke underline' onClick={() => setSelected([])}>
									پاک کردن همه
								</button>
							)}
						</div>
						<div className='min-h-32 rounded-[20px] border border-dashed border-ash bg-parchment p-3'>
							{selected.length === 0 ? (
								<p className='p-2 text-sm text-smoke'>هنوز دسته‌ای انتخاب نشده است.</p>
							) : (
								<ul className='flex flex-wrap gap-2'>
									{selected.map(item => (
										<li key={item.key} className='flex max-w-full items-center gap-1.5 rounded-full border border-ash bg-card py-1 pr-3 pl-1 text-sm' title={item.path}>
											<span className={`truncate ${item.raw ? 'font-mono text-xs' : ''}`} dir={item.raw ? 'auto' : undefined}>
												{item.name}
											</span>
											<button
												type='button'
												className='flex size-6 shrink-0 items-center justify-center rounded-full text-smoke hover:bg-parchment hover:text-off-black'
												onClick={() => setSelected(current => current.filter(entry => entry.key !== item.key))}
												aria-label={`حذف ${item.name}`}
											>
												<X size={14} aria-hidden />
											</button>
										</li>
									))}
								</ul>
							)}
						</div>
						<p className='text-xs leading-6 text-smoke'>برای هر دسته یک کار جداگانه ساخته می‌شود (حداکثر ۵۰ دسته در هر ارسال).</p>
					</div>
				</div>
			</Card>

			{/* ---------------- 2. settings ---------------- */}
			<Card kicker='۲' title='تنظیمات'>
				<div className='grid gap-4 md:grid-cols-3'>
					<label className='field-label'>
						مدل نگارش
						<select className='field' dir='ltr' value={draftModel} onChange={event => setDraftModel(event.target.value)} disabled={!config}>
							{(config?.models.draftOptions ?? []).map(model => (
								<option key={model} value={model}>
									{model}
								</option>
							))}
						</select>
					</label>
					<div className='field-label'>
						مدل بریف
						<code dir='ltr' className='field truncate !py-2.5 text-left font-mono text-xs leading-7'>
							{config?.models.brief ?? '…'}
						</code>
					</div>
					<label className='field-label'>
						برچسب (اختیاری)
						<input className='field' value={label} onChange={event => setLabel(event.target.value)} placeholder='مثلاً پایلوت ۱' maxLength={80} />
					</label>
				</div>
				<div className='mt-4 flex flex-wrap items-center gap-2' role='group' aria-label='هیومنایز'>
					<span className='text-sm text-graphite'>هیومنایز متن زیر لیست:</span>
					<button type='button' className='choice-button' aria-pressed={humanize} onClick={() => setHumanize(true)}>
						روشن
					</button>
					<button type='button' className='choice-button' aria-pressed={!humanize} onClick={() => setHumanize(false)}>
						خاموش
					</button>
					{config && (
						<span className='text-xs text-smoke'>
							نسخهٔ پرامپت: <bdi dir='ltr' className='font-mono'>{config.promptVersion}</bdi>
						</span>
					)}
				</div>
				<div className='mt-6 flex flex-wrap items-center gap-3'>
					<button type='button' className='primary-button' onClick={() => void submit()} disabled={!ready || !selected.length || submitting}>
						{submitting ? <LoaderCircle size={16} className='animate-spin' aria-hidden /> : <Play size={16} aria-hidden />}
						تولید محتوا{selected.length ? ` (${fa(selected.length)})` : ''}
					</button>
					{!selected.length && <span className='text-xs text-smoke'>ابتدا دست‌کم یک دسته انتخاب کنید.</span>}
				</div>
				{submitError && (
					<p className='mt-3 text-sm text-error-ink' role='alert'>
						{submitError}
					</p>
				)}
			</Card>

			{/* ---------------- 3. jobs ---------------- */}
			<Card
				kicker='۳'
				title='صف و نتایج'
				actions={
					<div className='flex flex-wrap gap-2'>
						<button type='button' className='outline-button' onClick={() => void refreshJobs()} disabled={!apiKey}>
							<RefreshCw size={16} aria-hidden /> به‌روزرسانی
						</button>
						<button type='button' className='outline-button' onClick={() => void exportAll()} disabled={!apiKey || ioBusy}>
							<Download size={16} aria-hidden /> دانلود همه (JSON)
						</button>
						<button type='button' className='outline-button' onClick={() => fileRef.current?.click()} disabled={!apiKey || ioBusy}>
							<Upload size={16} aria-hidden /> بارگذاری خروجی قبلی
						</button>
						<input
							ref={fileRef}
							type='file'
							accept='application/json,.json'
							className='hidden'
							onChange={event => {
								const file = event.target.files?.[0];
								if (file) void importFile(file);
							}}
						/>
					</div>
				}
			>
				{ioMessage && <p className='mb-3 text-sm text-graphite' aria-live='polite'>{ioMessage}</p>}
				{jobsError && <p className='mb-3 text-sm text-error-ink'>{jobsError}</p>}
				{anyActive && (
					<p className='mb-3 flex items-center gap-2 text-xs text-smoke'>
						<LoaderCircle size={14} className='animate-spin text-lake-blue' aria-hidden /> هر ۴ ثانیه به‌روز می‌شود.
					</p>
				)}
				{jobs.length === 0 ? (
					<p className='rounded-[20px] border border-ash bg-parchment p-4 text-sm text-smoke'>هنوز کاری ثبت نشده است.</p>
				) : (
					<div className='overflow-x-auto'>
						<table className='w-full min-w-[820px] text-right text-sm'>
							<thead className='text-xs text-smoke'>
								<tr>
									<th className='py-2 font-normal'>دسته</th>
									<th className='py-2 font-normal'>مدل</th>
									<th className='py-2 font-normal'>هیومنایز</th>
									<th className='py-2 font-normal'>وضعیت</th>
									<th className='py-2 font-normal'>QA</th>
									<th className='py-2 font-normal'>هزینه ($)</th>
									<th className='py-2 font-normal'>زمان</th>
									<th className='py-2 font-normal' aria-label='عملیات' />
								</tr>
							</thead>
							<tbody>
								{jobs.map(job => {
									const start = new Date(job.createdAt).getTime();
									const end = job.finishedAt ? new Date(job.finishedAt).getTime() : now || start;
									return (
										<tr key={job.id} className='border-t border-ash align-top'>
											<td className='max-w-56 py-2.5 pl-3'>
												<span className='font-medium text-off-black'>{job.meta.categoryName ?? job.meta.categoryId ?? '—'}</span>
												{job.meta.label && <span className='block text-xs text-smoke'>{job.meta.label}</span>}
											</td>
											<td className='py-2.5 pl-3 font-mono text-xs' dir='ltr'>
												{job.meta.draftModel ?? config?.models.draft ?? 'default'}
											</td>
											<td className='py-2.5 pl-3 text-xs'>{job.meta.humanize === false ? 'خیر' : 'بله'}</td>
											<td className='max-w-64 py-2.5 pl-3'>
												<span className='flex items-center gap-1.5'>
													{isActive(job) ? <LoaderCircle size={14} className='animate-spin text-lake-blue' aria-hidden /> : <StatusDot state={job.status === 'succeeded' ? 'ok' : job.status === 'failed' ? 'bad' : 'unknown'} />}
													{STATUS_LABELS[job.status] ?? job.status}
												</span>
												{isActive(job) && job.currentStep?.message && <span className='mt-0.5 block text-xs text-smoke'>{job.currentStep.message}</span>}
												{job.error && <span className='mt-0.5 block text-xs text-error-ink'>{job.error}</span>}
											</td>
											<td className='py-2.5 pl-3'>
												<QaBadge level={job.qa} />
											</td>
											<td className='py-2.5 pl-3 font-mono text-xs' dir='ltr'>
												{usd(job.costUsd)}
											</td>
											<td className='py-2.5 pl-3 text-xs whitespace-nowrap text-graphite'>
												<bdi>{formatTime(job.createdAt)}</bdi>
												<span className='block font-mono text-smoke' dir='ltr'>
													{formatDuration(end - start)}
												</span>
											</td>
											<td className='py-2.5 whitespace-nowrap'>
												{isActive(job) && (
													<button type='button' className='secondary-button !min-h-9 !px-3 !text-xs' onClick={() => void cancelJob(job.id)}>
														<Square size={13} aria-hidden /> لغو
													</button>
												)}
												{job.status === 'succeeded' && job.resultId && (
													<button
														type='button'
														className='outline-button !min-h-9 !px-3 !text-xs'
														onClick={() => void openResult(job.resultId!)}
														disabled={resultLoading === job.resultId}
														aria-pressed={result?.resultId === job.resultId}
													>
														{resultLoading === job.resultId ? <LoaderCircle size={13} className='animate-spin' aria-hidden /> : <Eye size={13} aria-hidden />}
														مشاهده
													</button>
												)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				)}
				{resultError && <p className='mt-3 text-sm text-error-ink'>{resultError}</p>}
			</Card>

			{/* ---------------- 4. saved results ---------------- */}
			<Card
				kicker='۴'
				title={`نتایج ذخیره‌شده (${saved.length.toLocaleString('fa-IR')})`}
				actions={
					<div className='flex flex-wrap items-center gap-2'>
						<select className='field !min-h-10 !py-1.5 text-xs' value={savedLabel} onChange={event => setSavedLabel(event.target.value)} aria-label='فیلتر بر اساس برچسب'>
							<option value=''>همهٔ برچسب‌ها</option>
							{savedLabels.map(l => (
								<option key={l || 'none'} value={l}>
									{l || 'بدون برچسب'}
								</option>
							))}
						</select>
						<button type='button' className='outline-button' onClick={() => void refreshSaved()} disabled={!apiKey}>
							<RefreshCw size={16} aria-hidden /> به‌روزرسانی
						</button>
					</div>
				}
			>
				<p className='mb-3 text-xs leading-6 text-smoke'>همهٔ خروجی‌های تولیدشده اینجا می‌مانند (حتی بعد از خوابیدن سرویس)؛ برای هر دسته ۱۰ نسخهٔ آخر نگه داشته می‌شود.</p>
				{savedVisible.length === 0 ? (
					<p className='rounded-[20px] border border-ash bg-parchment p-4 text-sm text-smoke'>نتیجه‌ای ذخیره نشده است.</p>
				) : (
					<div className='overflow-x-auto'>
						<table className='w-full min-w-[820px] text-right text-sm'>
							<thead className='text-xs text-smoke'>
								<tr>
									<th className='py-2 font-normal'>دسته</th>
									<th className='py-2 font-normal'>سطح</th>
									<th className='py-2 font-normal'>مدل</th>
									<th className='py-2 font-normal'>هیومنایز</th>
									<th className='py-2 font-normal'>QA</th>
									<th className='py-2 font-normal'>کلمه</th>
									<th className='py-2 font-normal'>هزینه ($)</th>
									<th className='py-2 font-normal'>تاریخ</th>
									<th className='py-2 font-normal' aria-label='عملیات' />
								</tr>
							</thead>
							<tbody>
								{savedVisible.map(r => (
									<tr key={r.resultId} className='border-t border-ash align-top'>
										<td className='max-w-56 py-2.5 pl-3'>
											<span className='font-medium text-off-black'>{r.category.name}</span>
											{r.label && <span className='block text-xs text-smoke'>{r.label}</span>}
										</td>
										<td className='py-2.5 pl-3 text-xs'>{TIER_LABELS[r.category.tier] ?? r.category.tier}</td>
										<td className='py-2.5 pl-3 font-mono text-xs' dir='ltr'>{r.models.draft}</td>
										<td className='py-2.5 pl-3 text-xs'>{r.models.humanize ? 'بله' : 'خیر'}</td>
										<td className='py-2.5 pl-3'><QaBadge level={r.qa} /></td>
										<td className='py-2.5 pl-3 font-mono text-xs' dir='ltr'>{r.words}</td>
										<td className='py-2.5 pl-3 font-mono text-xs' dir='ltr'>{usd(r.costUsd ?? undefined)}</td>
										<td className='py-2.5 pl-3 text-xs whitespace-nowrap text-graphite'><bdi>{formatDateTime(r.createdAt)}</bdi></td>
										<td className='py-2.5 whitespace-nowrap'>
											<button
												type='button'
												className='outline-button !min-h-9 !px-3 !text-xs'
												onClick={() => void openResult(r.resultId)}
												disabled={resultLoading === r.resultId}
												aria-pressed={result?.resultId === r.resultId}
											>
												{resultLoading === r.resultId ? <LoaderCircle size={13} className='animate-spin' aria-hidden /> : <Eye size={13} aria-hidden />}
												مشاهده
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Card>

			{/* ---------------- bulk generation ---------------- */}
			{apiKey && <CampaignsCard apiKey={apiKey} />}

			{/* ---------------- 5. result viewer ---------------- */}
			{result && (
				<div ref={viewerRef} className='scroll-mt-6'>
					<ResultViewer result={result} belowHtml={belowHtml} draftHtml={draftHtml} tab={tab} setTab={setTab} copied={copied} copy={copy} onClose={() => setResult(null)} />
				</div>
			)}
		</div>
	);
}

/* ---------- result viewer ---------- */

function ResultViewer({
	result,
	belowHtml,
	draftHtml,
	tab,
	setTab,
	copied,
	copy,
	onClose,
}: {
	result: ContentResult;
	belowHtml: string;
	draftHtml: string;
	tab: Tab;
	setTab: (tab: Tab) => void;
	copied: string | null;
	copy: (id: string, value: string) => void;
	onClose: () => void;
}) {
	const { category, content, brief, data, qa } = result;
	const metaText = `${content.metaTitle}\n${content.metaDescription}`;

	return (
		<section className='paper-panel min-w-0 p-5 sm:p-8' aria-label='نمایش نتیجه'>
			<div className='mb-5 flex flex-wrap items-start justify-between gap-3'>
				<div className='min-w-0'>
					<span className='section-kicker !text-sm'>۴ · نتیجه</span>
					<h2 className='flex flex-wrap items-center gap-2 text-xl font-bold text-off-black sm:text-2xl'>
						{category.name}
						<QaBadge level={qa.level} />
					</h2>
					<p className='mt-1 text-xs leading-6 text-smoke'>{category.path}</p>
				</div>
				<button type='button' className='outline-button !min-h-9 !px-3' onClick={onClose} aria-label='بستن نتیجه'>
					<X size={16} aria-hidden />
				</button>
			</div>

			<div className='mb-5 flex flex-wrap gap-2'>
				<Chip>{TIER_LABELS[category.tier] ?? category.tier}</Chip>
				<Chip>
					<bdi>{fa(category.productCount)}</bdi> محصول
				</Chip>
				<Chip>
					بریف: <bdi dir='ltr' className='font-mono'>{result.models.brief}</bdi>
				</Chip>
				<Chip>
					نگارش: <bdi dir='ltr' className='font-mono'>{result.models.draft}</bdi>
				</Chip>
				<Chip>هیومنایز: {result.models.humanize ? 'بله' : 'خیر'}</Chip>
				<Chip>
					پرامپت: <bdi dir='ltr' className='font-mono'>{result.promptVersion}</bdi>
				</Chip>
				<Chip>
					هزینه: <bdi dir='ltr' className='font-mono'>{usd(result.cost.usd)}</bdi> · <bdi>{fa(result.cost.calls)}</bdi> فراخوانی
				</Chip>
				<Chip>
					مدت: <bdi dir='ltr' className='font-mono'>{formatDuration(result.durationMs)}</bdi>
				</Chip>
				{result.label && <Chip tone='blue'>{result.label}</Chip>}
				{category.url && (
					<a href={category.url} target='_blank' rel='noreferrer' className='inline-flex items-center gap-1 rounded-full bg-periwinkle px-2.5 py-0.5 text-xs text-lake-blue'>
						<ExternalLink size={12} aria-hidden /> صفحهٔ دسته
					</a>
				)}
			</div>

			<div className='mb-5 flex flex-wrap gap-2'>
				<CopyBtn id='above' value={content.above} copied={copied} copy={copy} label='کپی بالای لیست' />
				<CopyBtn id='below-md' value={content.below} copied={copied} copy={copy} label='کپی زیر لیست (Markdown)' />
				<CopyBtn id='below-html' value={belowHtml} copied={copied} copy={copy} label='کپی HTML زیر لیست' />
				<CopyBtn id='meta' value={metaText} copied={copied} copy={copy} label='کپی عنوان و توضیح متا' />
			</div>

			<div className='mb-5 flex flex-wrap gap-1' role='group' aria-label='بخش‌های نتیجه'>
				{TABS.map(([id, title]) => (
					<button key={id} type='button' aria-pressed={tab === id} className='choice-button' onClick={() => setTab(id)}>
						{title}
					</button>
				))}
			</div>

			<div className='min-w-0'>
				{tab === 'preview' && (
					<div className='flex flex-col gap-6'>
						<div className='rounded-[24px] border border-ash bg-card p-5 sm:p-6'>
							<h3 className='mb-3 text-lg font-bold text-off-black'>{category.name}</h3>
							<p className='text-sm leading-8 whitespace-pre-wrap text-off-black'>{content.above}</p>
							<div className='my-6 flex min-h-32 items-center justify-center rounded-[16px] bg-field text-sm text-smoke'>[لیست محصولات]</div>
							<Markdown html={belowHtml} />
						</div>
						<div>
							<p className='mb-2 text-sm font-medium text-off-black'>پیش‌نمایش در نتایج گوگل</p>
							<div className='max-w-2xl rounded-[20px] border border-ash bg-white p-4' dir='rtl'>
								<p className='truncate text-xs text-green-700' dir='ltr'>
									{category.url ?? '—'}
								</p>
								<p className='mt-1 text-lg leading-7 text-[#1a0dab]'>{content.metaTitle}</p>
								<p className='mt-1 text-sm leading-6 text-graphite'>{content.metaDescription}</p>
								<p className='mt-2 text-xs text-smoke'>
									عنوان <bdi>{fa(content.metaTitle.length)}</bdi> نویسه · توضیح <bdi>{fa(content.metaDescription.length)}</bdi> نویسه
								</p>
							</div>
						</div>
					</div>
				)}

				{tab === 'compare' && (
					<div className='flex flex-col gap-4'>
						{!result.humanized.applied && (
							<p className='rounded-[20px] bg-review-wash px-4 py-3 text-sm text-error-ink'>
								هیومنایز روی این نتیجه اعمال نشده است.{result.humanized.warning ? ` ${result.humanized.warning}` : ''}
							</p>
						)}
						{result.humanized.applied && result.humanized.warning && <p className='text-xs leading-6 text-graphite'>⚠ {result.humanized.warning}</p>}
						<div className='grid gap-4 lg:grid-cols-2'>
							{(
								[
									['پیش‌نویس (پیش از هیومنایز)', draftHtml, result.draftBelow, result.qaDraft.level],
									['نسخهٔ نهایی', belowHtml, content.below, qa.level],
								] as const
							).map(([title, html, raw, level]) => (
								<div key={title} className='min-w-0 rounded-[24px] border border-ash bg-card p-4 sm:p-5'>
									<p className='mb-3 flex flex-wrap items-center gap-2 text-sm font-medium text-off-black'>
										{title}
										<span className='text-xs font-normal text-smoke'>
											<bdi>{fa(wordCount(raw))}</bdi> کلمه
										</span>
										<QaBadge level={level} />
									</p>
									<div className='max-h-[40rem] overflow-y-auto'>
										<Markdown html={html} />
									</div>
								</div>
							))}
						</div>
					</div>
				)}

				{tab === 'qa' && (
					<div className='flex flex-col gap-4'>
						<div className='flex flex-wrap gap-3 text-sm'>
							<span className='flex items-center gap-2 rounded-[20px] border border-ash bg-parchment px-4 py-2'>
								<StatusDot state={qaDot(qa.level)} /> نسخهٔ نهایی: <QaBadge level={qa.level} />
								<span className='text-xs text-smoke'>
									<bdi>{fa(qa.words)}</bdi> کلمه
								</span>
							</span>
							<span className='flex items-center gap-2 rounded-[20px] border border-ash bg-parchment px-4 py-2'>
								<StatusDot state={qaDot(result.qaDraft.level)} /> پیش‌نویس: <QaBadge level={result.qaDraft.level} />
								<span className='text-xs text-smoke'>
									<bdi>{fa(result.qaDraft.words)}</bdi> کلمه
								</span>
							</span>
						</div>
						<ul className='flex flex-col divide-y divide-ash rounded-[20px] border border-ash bg-card'>
							{qa.checks.map(check => (
								<li key={check.id} className='flex items-start gap-3 px-4 py-3 text-sm'>
									<span className='pt-2'>
										<StatusDot state={qaDot(check.level)} />
									</span>
									<span className='min-w-0'>
										<span className='font-medium text-off-black'>{check.label}</span>
										{check.detail && <span className='mt-0.5 block text-xs leading-6 break-words text-graphite'>{check.detail}</span>}
									</span>
								</li>
							))}
							{!qa.checks.length && <li className='px-4 py-3 text-sm text-smoke'>بررسی‌ای ثبت نشده است.</li>}
						</ul>
					</div>
				)}

				{tab === 'brief' && (
					<div className='grid gap-4 md:grid-cols-2'>
						{data.siteError && (
							<p className='rounded-[20px] bg-review-wash px-4 py-3 text-sm text-error-ink md:col-span-2' role='alert'>
								خطای دریافت داده از سایت: {data.siteError}
							</p>
						)}
						<Block title='زاویهٔ صفحه'>{brief.angle || '—'}</Block>
						<Block title='مخاطب و نیت جستجو'>
							<p>{AUDIENCE_LABELS[brief.audience] ?? brief.audience}</p>
							<p>{brief.search_intent || '—'}</p>
						</Block>
						{brief.term_explanation && (
							<div className='md:col-span-2'>
								<Block title='توضیح اصطلاح'>{brief.term_explanation}</Block>
							</div>
						)}
						<div className='md:col-span-2'>
							<Block title='مفاهیم مرتبط (LSI)'>
								<div className='flex flex-wrap gap-1.5'>
									{brief.lsi.length ? brief.lsi.map(term => <Chip key={term}>{term}</Chip>) : '—'}
								</div>
							</Block>
						</div>
						<div className='md:col-span-2'>
							<Block title='تیترها'>
								<ol className='list-decimal pr-5'>
									{brief.headings.map(heading => (
										<li key={heading.h2} className='mb-1'>
											<span className='font-medium text-off-black'>{heading.h2}</span>{' '}
											<span className='text-xs text-smoke'>({FORMAT_LABELS[heading.format] ?? heading.format})</span>
											<span className='block text-xs'>{heading.covers}</span>
										</li>
									))}
								</ol>
							</Block>
						</div>
						<div className='md:col-span-2'>
							<Block title={`واقعیت‌ها (${fa(brief.facts.length)}) · حذف‌شده: ${fa(brief.droppedFacts ?? 0)}`}>
								{brief.facts.length ? (
									<ul className='flex flex-col gap-2'>
										{brief.facts.map((fact, index) => (
											<li key={index}>
												<span className='text-off-black'>{fact.fact}</span>
												<span className='block text-xs text-smoke'>مستند: {fact.evidence}</span>
											</li>
										))}
									</ul>
								) : (
									'—'
								)}
							</Block>
						</div>
						<Block title='برندها (بریف)'>
							{brief.brands.length ? (
								<ul className='flex flex-col gap-1.5'>
									{brief.brands.map(brand => (
										<li key={brand.name}>
											<span className='text-off-black'>{brand.name}</span>
											<span className='block text-xs text-smoke'>{brand.evidence}</span>
										</li>
									))}
								</ul>
							) : (
								'—'
							)}
						</Block>
						<Block title='پیش از سفارش بررسی کنید'>
							<ul className='list-disc pr-5'>{brief.check_before_order.map(item => <li key={item}>{item}</li>)}</ul>
						</Block>
						<Block title='اشتباه‌های رایج'>
							<ul className='list-disc pr-5'>{brief.common_mistakes.map(item => <li key={item}>{item}</li>)}</ul>
						</Block>
						<Block title='سؤالات متداول'>
							<ul className='list-disc pr-5'>{brief.faq.map(item => <li key={item}>{item}</li>)}</ul>
						</Block>
						<div className='md:col-span-2'>
							<Block title='واژه‌نامه'>
								{brief.glossary.length ? (
									<dl className='grid gap-2 sm:grid-cols-2'>
										{brief.glossary.map(entry => (
											<div key={entry.term}>
												<dt className='font-medium text-off-black'>{entry.term}</dt>
												<dd className='text-xs leading-6'>{entry.explain}</dd>
											</div>
										))}
									</dl>
								) : (
									'—'
								)}
							</Block>
						</div>
						<Block title={`برندهای داده (نمونهٔ ${fa(data.productSample)} محصول)`}>
							<div className='flex flex-wrap gap-1.5'>
								{data.brands.length
									? data.brands.map(brand => (
											<Chip key={brand.brand}>
												{brand.brand} <bdi className='text-smoke'>{fa(brand.count)}</bdi>
											</Chip>
										))
									: '—'}
							</div>
						</Block>
						<Block title='مشخصات مشاهده‌شده'>
							{Object.keys(data.specs).length ? (
								<ul className='flex flex-col gap-1.5'>
									{Object.entries(data.specs).map(([unit, values]) => (
										<li key={unit} className='break-words'>
											<span className='font-medium text-off-black'>{unit}:</span> <bdi>{values.join('، ')}</bdi>
										</li>
									))}
								</ul>
							) : (
								'—'
							)}
						</Block>
					</div>
				)}
			</div>
		</section>
	);
}
