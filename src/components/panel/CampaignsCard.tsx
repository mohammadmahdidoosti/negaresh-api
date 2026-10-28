'use client';

import { LoaderCircle, Pause, Play, RefreshCw, Square } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface CampaignView {
	id: string;
	label: string;
	createdAt: string;
	status: 'running' | 'paused' | 'done' | 'canceled';
	note?: string;
	total: number;
	maxUsd?: number;
	queued: number;
	inflight: string[];
	done: number;
	failed: number;
	skipped: number;
	spentUsd: number;
	promptVersion: string;
}

interface LogEntry {
	at: string;
	categoryId: string;
	name: string;
	outcome: 'done' | 'failed' | 'skipped';
	qa?: string;
	usd?: number | null;
	error?: string;
}

const fa = (n: number) => n.toLocaleString('fa-IR');
const STATUS: Record<CampaignView['status'], string> = { running: 'در حال اجرا', paused: 'متوقف', done: 'تمام‌شده', canceled: 'لغوشده' };
const OUTCOME: Record<LogEntry['outcome'], string> = { done: 'انجام شد', failed: 'خطا', skipped: 'بدون محصول' };

/** Bulk generation: create a campaign, watch progress, pause/resume/cancel. Survives redeploys. */
export default function CampaignsCard({ apiKey }: { apiKey: string }) {
	const [items, setItems] = useState<CampaignView[]>([]);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [label, setLabel] = useState('');
	const [limit, setLimit] = useState('100');
	const [maxUsd, setMaxUsd] = useState('2');
	const [onlyMissing, setOnlyMissing] = useState(true);
	const [openId, setOpenId] = useState<string | null>(null);
	const [log, setLog] = useState<LogEntry[]>([]);

	const call = useCallback(
		async (path: string, init?: RequestInit) => {
			const res = await fetch(path, { ...init, cache: 'no-store', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error((data as { error?: { message?: string } }).error?.message || 'درخواست ناموفق بود.');
			return data;
		},
		[apiKey],
	);

	const refresh = useCallback(async () => {
		if (!apiKey) return;
		try {
			const data = (await call('/api/v1/content/campaigns')) as { campaigns: CampaignView[] };
			setItems(data.campaigns);
			setError('');
			if (openId) {
				const one = (await call(`/api/v1/content/campaigns/${openId}?log=50`)) as { log: LogEntry[] };
				setLog(one.log);
			}
		} catch (e) {
			setError((e as Error).message);
		}
	}, [apiKey, call, openId]);

	useEffect(() => {
		const first = setTimeout(() => void refresh(), 0);
		const timer = setInterval(() => void refresh(), 10_000);
		return () => {
			clearTimeout(first);
			clearInterval(timer);
		};
	}, [refresh]);

	const create = async () => {
		setBusy(true);
		try {
			await call('/api/v1/content/campaigns', {
				method: 'POST',
				body: JSON.stringify({
					label: label.trim() || undefined,
					limit: Number(limit) > 0 ? Number(limit) : undefined,
					maxUsd: Number(maxUsd) > 0 ? Number(maxUsd) : undefined,
					onlyMissing,
				}),
			});
			setLabel('');
			await refresh();
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	};

	const act = async (id: string, action: 'pause' | 'resume' | 'cancel') => {
		if (action === 'cancel' && !window.confirm('این تولید انبوه لغو شود؟ دسته‌های باقی‌مانده ساخته نمی‌شوند.')) return;
		try {
			await call(`/api/v1/content/campaigns/${id}`, { method: 'POST', body: JSON.stringify({ action }) });
			await refresh();
		} catch (e) {
			setError((e as Error).message);
		}
	};

	return (
		<section className='paper-panel min-w-0 p-5 sm:p-8'>
			<div className='mb-6 flex flex-wrap items-end justify-between gap-3'>
				<div>
					<span className='section-kicker !text-sm'>تولید انبوه</span>
					<h2 className='text-xl font-bold text-off-black sm:text-2xl'>صف دائمی دسته‌ها</h2>
				</div>
				<button type='button' className='outline-button' onClick={() => void refresh()} disabled={!apiKey}>
					<RefreshCw size={16} aria-hidden /> به‌روزرسانی
				</button>
			</div>
			<p className='mb-4 text-sm leading-7 text-graphite'>
				دسته‌های دارای محصول به ترتیب تعداد محصول (مهم‌ترها اول) ساخته می‌شوند. صف روی سرور ذخیره است و بعد از ری‌استارت یا به‌روزرسانی سرور خودش ادامه می‌دهد. با رسیدن به سقف هزینه، متوقف می‌شود.
			</p>
			<div className='grid gap-4 md:grid-cols-4'>
				<label className='field-label'>
					برچسب
					<input className='field' value={label} onChange={e => setLabel(e.target.value)} placeholder='مثلاً دستهٔ اول ۱۰۰ تایی' maxLength={80} />
				</label>
				<label className='field-label'>
					تعداد دسته (خالی = همه)
					<input className='field' inputMode='numeric' dir='ltr' value={limit} onChange={e => setLimit(e.target.value.replace(/[^0-9]/g, ''))} />
				</label>
				<label className='field-label'>
					سقف هزینه (دلار)
					<input className='field' inputMode='decimal' dir='ltr' value={maxUsd} onChange={e => setMaxUsd(e.target.value.replace(/[^0-9.]/g, ''))} />
				</label>
				<div className='field-label'>
					دسته‌هایی که نتیجهٔ نسخهٔ فعلی دارند
					<div className='flex gap-2'>
						<button type='button' className='choice-button' aria-pressed={onlyMissing} onClick={() => setOnlyMissing(true)}>
							رد شوند
						</button>
						<button type='button' className='choice-button' aria-pressed={!onlyMissing} onClick={() => setOnlyMissing(false)}>
							دوباره ساخته شوند
						</button>
					</div>
				</div>
			</div>
			<div className='mt-4'>
				<button type='button' className='primary-button' onClick={() => void create()} disabled={!apiKey || busy}>
					{busy ? <LoaderCircle size={16} className='animate-spin' aria-hidden /> : <Play size={16} aria-hidden />}
					شروع تولید انبوه
				</button>
			</div>
			{error && (
				<p className='mt-3 text-sm text-error-ink' role='alert'>
					{error}
				</p>
			)}

			{items.length > 0 && (
				<div className='mt-6 space-y-3'>
					{items.map(c => {
						const finished = c.done + c.failed + c.skipped;
						const pct = c.total ? Math.round((finished / c.total) * 100) : 0;
						return (
							<div key={c.id} className='rounded-[20px] border border-ash bg-parchment p-4'>
								<div className='flex flex-wrap items-center justify-between gap-2'>
									<div className='min-w-0'>
										<p className='truncate text-sm font-medium text-off-black'>{c.label}</p>
										<p className='text-xs text-smoke'>
											{STATUS[c.status]} · {fa(finished)} از {fa(c.total)} ({fa(pct)}٪) · انجام {fa(c.done)} · خطا {fa(c.failed)} · بدون محصول {fa(c.skipped)} · هزینه{' '}
											<bdi dir='ltr'>${c.spentUsd.toFixed(2)}</bdi>
											{c.maxUsd ? (
												<>
													{' '}
													از <bdi dir='ltr'>${c.maxUsd}</bdi>
												</>
											) : null}
										</p>
										{c.note && <p className='text-xs text-error-ink'>{c.note}</p>}
									</div>
									<div className='flex flex-wrap gap-2'>
										{c.status === 'running' && (
											<button type='button' className='outline-button' onClick={() => void act(c.id, 'pause')}>
												<Pause size={14} aria-hidden /> توقف
											</button>
										)}
										{c.status === 'paused' && (
											<button type='button' className='outline-button' onClick={() => void act(c.id, 'resume')}>
												<Play size={14} aria-hidden /> ادامه
											</button>
										)}
										{(c.status === 'running' || c.status === 'paused') && (
											<button type='button' className='outline-button' onClick={() => void act(c.id, 'cancel')}>
												<Square size={14} aria-hidden /> لغو
											</button>
										)}
										<button type='button' className='outline-button' onClick={() => setOpenId(openId === c.id ? null : c.id)}>
											{openId === c.id ? 'بستن گزارش' : 'گزارش'}
										</button>
									</div>
								</div>
								<div className='mt-3 h-2 overflow-hidden rounded-full bg-ash' aria-hidden>
									<div className='h-full bg-lake-blue transition-all' style={{ width: `${pct}%` }} />
								</div>
								{openId === c.id && (
									<ul className='mt-3 max-h-72 space-y-1 overflow-auto text-xs text-graphite'>
										{log.length === 0 && <li>هنوز چیزی ثبت نشده.</li>}
										{log.map(l => (
											<li key={`${l.at}-${l.categoryId}`} className='flex flex-wrap gap-2'>
												<span className='font-medium text-off-black'>{l.name}</span>
												<span>{OUTCOME[l.outcome]}</span>
												{l.qa && <span>کنترل کیفیت: {l.qa === 'pass' ? 'قبول' : l.qa === 'warn' ? 'نیاز به نگاه' : 'ایراد'}</span>}
												{typeof l.usd === 'number' && <bdi dir='ltr'>${l.usd.toFixed(4)}</bdi>}
												{l.error && <span className='text-error-ink'>{l.error}</span>}
											</li>
										))}
									</ul>
								)}
							</div>
						);
					})}
				</div>
			)}
		</section>
	);
}
