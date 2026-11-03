'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Row {
	catId: string;
	name: string;
	path: string;
	q: string;
	bucket: 'blog' | 'category';
	status: 'pending' | 'approved' | 'rejected' | 'applied';
}

const STATUS_LABEL: Record<Row['status'], string> = { pending: 'در انتظار', approved: 'تأیید شد', rejected: 'رد شد', applied: 'اعمال شد' };

export default function KeywordReview() {
	const [apiKey, setApiKey] = useState('');
	const [rows, setRows] = useState<Row[]>([]);
	const [bucket, setBucket] = useState<'category' | 'blog'>('category');
	const [status, setStatus] = useState<Row['status']>('pending');
	const [q, setQ] = useState('');
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const headers = useMemo(() => ({ Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }), [apiKey]);

	useEffect(() => {
		void (async () => {
			const res = await fetch('/api/panel/connection', { cache: 'no-store', credentials: 'same-origin' });
			const data = (await res.json().catch(() => ({}))) as { apiKey?: string | null };
			if (data.apiKey) setApiKey(data.apiKey);
			else setError('کلید API پنل پیدا نشد؛ وارد پنل شوید.');
		})();
	}, []);

	const load = useCallback(async () => {
		if (!apiKey) return;
		const res = await fetch(`/api/v1/content/keywords/review?status=${status}&bucket=${bucket}`, { headers, cache: 'no-store' });
		const data = (await res.json()) as { rows?: Row[] };
		setRows(data.rows ?? []);
	}, [apiKey, headers, status, bucket]);
	useEffect(() => {
		const timer = setTimeout(() => void load(), 0);
		return () => clearTimeout(timer);
	}, [load]);

	const decide = async (items: Array<Partial<Row> & { catId: string; q: string }>) => {
		setBusy(true);
		try {
			await fetch('/api/v1/content/keywords/review', { method: 'POST', headers, body: JSON.stringify({ action: 'decide', items }) });
			await load();
		} finally {
			setBusy(false);
		}
	};

	const shown = rows.filter(r => !q || r.q.includes(q) || r.path.includes(q));
	const groups = useMemo(() => {
		const m = new Map<string, Row[]>();
		for (const r of shown) m.set(r.path, [...(m.get(r.path) ?? []), r]);
		return [...m.entries()];
	}, [shown]);

	return (
		<section className='paper-panel min-w-0 p-5 sm:p-8' dir='rtl'>
			{error && <p className='mb-4 rounded-[20px] bg-review-wash px-4 py-3 text-sm text-error-ink'>{error}</p>}
			<div className='mb-5 flex flex-wrap items-center gap-2'>
				<button type='button' className={bucket === 'category' ? 'primary-button' : 'outline-button'} onClick={() => setBucket('category')}>برای صفحهٔ دسته</button>
				<button type='button' className={bucket === 'blog' ? 'primary-button' : 'outline-button'} onClick={() => setBucket('blog')}>برای بلاگ</button>
				<select className='outline-button' value={status} onChange={e => setStatus(e.target.value as Row['status'])}>
					{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
				</select>
				<input className='outline-button min-w-48' placeholder='جست‌وجو در عبارت یا دسته' value={q} onChange={e => setQ(e.target.value)} />
				<a className='outline-button' href={apiKey ? `/api/v1/content/keywords/review?bucket=blog&format=csv` : '#'} onClick={async e => {
					e.preventDefault();
					const res = await fetch(`/api/v1/content/keywords/review?bucket=${bucket}&format=csv`, { headers });
					const url = URL.createObjectURL(await res.blob());
					const a = document.createElement('a');
					a.href = url;
					a.download = `keywords-${bucket}.csv`;
					a.click();
				}}>دانلود CSV</a>
				<span className='text-sm text-graphite'>{shown.length} عبارت در {groups.length} دسته</span>
			</div>
			<p className='mb-5 text-sm leading-7 text-graphite'>
				{bucket === 'category'
					? 'عبارت‌های تأییدشده در به‌روزرسانی ماهانه به صفحهٔ همان دسته اضافه می‌شوند (از روی دادهٔ واقعی محصولات). اگر عبارتی بیشتر به درد مقاله می‌خورد، «به بلاگ» را بزنید.'
					: 'این عبارت‌ها سؤال‌های آموزشی کاربران‌اند و برای برنامهٔ محتوای بلاگ پیشنهاد می‌شوند؛ با «دانلود CSV» فهرستشان را بگیرید.'}
			</p>
			<div className='flex flex-col gap-4'>
				{groups.map(([path, list]) => (
					<div key={path} className='rounded-[20px] border border-ash bg-parchment p-4'>
						<div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
							<p className='text-sm font-medium text-off-black'>{path}</p>
							{status === 'pending' && (
								<div className='flex gap-2'>
									<button type='button' disabled={busy} className='outline-button !min-h-8 !px-3 !text-xs' onClick={() => decide(list.map(r => ({ catId: r.catId, q: r.q, status: 'approved' })))}>تأیید همه</button>
									<button type='button' disabled={busy} className='outline-button !min-h-8 !px-3 !text-xs' onClick={() => decide(list.map(r => ({ catId: r.catId, q: r.q, status: 'rejected' })))}>رد همه</button>
								</div>
							)}
						</div>
						<ul className='flex flex-col gap-2'>
							{list.map(r => (
								<li key={r.q} className='flex flex-wrap items-center justify-between gap-2 text-sm'>
									<span>{r.q}</span>
									<span className='flex gap-2'>
										{r.status !== 'approved' && <button type='button' disabled={busy} className='outline-button !min-h-8 !px-3 !text-xs' onClick={() => decide([{ catId: r.catId, q: r.q, status: 'approved' }])}>تأیید</button>}
										{r.status !== 'rejected' && <button type='button' disabled={busy} className='outline-button !min-h-8 !px-3 !text-xs' onClick={() => decide([{ catId: r.catId, q: r.q, status: 'rejected' }])}>رد</button>}
										<button type='button' disabled={busy} className='outline-button !min-h-8 !px-3 !text-xs' onClick={() => decide([{ catId: r.catId, q: r.q, bucket: r.bucket === 'blog' ? 'category' : 'blog' }])}>{r.bucket === 'blog' ? 'به دسته' : 'به بلاگ'}</button>
									</span>
								</li>
							))}
						</ul>
					</div>
				))}
				{!groups.length && <p className='text-sm text-graphite'>عبارتی در این فهرست نیست.</p>}
			</div>
		</section>
	);
}
