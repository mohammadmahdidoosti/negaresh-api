/** Root client component for the single-flow editor. */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { useMounted } from '@/hooks/useMounted';
import { clearHistory, loadAuthorProfile, loadHistory, saveAuthorProfile, saveHistory } from '@/lib/history';
import { assessPublicationReadiness, reconcileAnalysisWithText } from '@/lib/publication';
import { judgeLocally } from '@/lib/quality';
import { validateInput } from '@/lib/text';
import {
	CONTENT_TYPES,
	MAX_CONTEXT_CHARS,
	MAX_INPUT_CHARS,
	PERSPECTIVES,
	QUALITY_LEVELS,
	VOICES,
	type ContentType,
	type EeatAnalysis,
	type HistoryEntry,
	type HumanizeResponse,
	type MetricsPair,
	type NarrativePerspective,
	type PublicationReadiness,
	type QualityLevel,
	type QualityReport,
	type Voice,
} from '@/lib/types';
import ContextReadiness from './ContextReadiness';
import EditorialControls from './EditorialControls';
import EeatPanel from './EeatPanel';
import HistoryList from './HistoryList';
import MetricsPanel from './MetricsPanel';
import OutputPanel from './OutputPanel';
import PublicationStrip from './PublicationStrip';
import QualityStrip from './QualityStrip';
import TextInput from './TextInput';
import VoiceSelector from './VoiceSelector';
import { Disclosure } from './ui/Disclosure';
import { Icon } from './ui/Icon';
import { Select } from './ui/Select';

const PERSPECTIVE_LABELS: Record<NarrativePerspective, string> = {
	third_person: 'زاویه دید سوم‌شخص / بی‌طرف',
	first_person_singular: 'اول‌شخص تجربی / من',
	first_person_plural: 'اول‌شخص تیمی / ما',
};

const PERSPECTIVE_OPTIONS = PERSPECTIVES.map(value => ({
	value,
	label: PERSPECTIVE_LABELS[value],
}));

interface SseFrame {
	event: string;
	data: unknown;
}

function parseSseBlock(block: string): SseFrame | null {
	let event = 'message';
	const dataLines: string[] = [];
	for (const line of block.split('\n')) {
		if (line.startsWith('event:')) event = line.slice(6).trim();
		else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
	}
	if (!dataLines.length) return null;
	const raw = dataLines.join('\n');
	try {
		return { event, data: JSON.parse(raw) };
	} catch {
		return { event, data: raw };
	}
}

async function consumeSse(response: Response, onFrame: (frame: SseFrame) => void): Promise<void> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error('empty stream');
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				if (buffer.trim()) {
					const frame = parseSseBlock(buffer);
					if (frame) onFrame(frame);
				}
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			const blocks = buffer.split('\n\n');
			buffer = blocks.pop() ?? '';
			for (const block of blocks) {
				const frame = parseSseBlock(block);
				if (frame) onFrame(frame);
			}
		}
	} finally {
		reader.releaseLock();
	}
}

export default function HumanizerApp() {
	const mounted = useMounted();
	const [voice, setVoice] = useState<Voice>('standard');
	const [contentType, setContentType] = useState<ContentType>('general');
	const [perspective, setPerspective] = useState<NarrativePerspective>('third_person');
	const [qualityLevel, setQualityLevel] = useState<QualityLevel>('readable');
	const activeRequest = useRef<AbortController | null>(null);
	const [targetWords, setTargetWords] = useState('');
	const [wordTolerance, setWordTolerance] = useState('10');
	useEffect(() => () => activeRequest.current?.abort(), []);
	const [input, setInput] = useState('');
	const [articleGoal, setArticleGoal] = useState('');
	const [audience, setAudience] = useState('');
	const [sources, setSources] = useState('');
	const [notes, setNotes] = useState('');
	const [keywords, setKeywords] = useState('');
	const [authorProfile, setAuthorProfile] = useState('');
	const [writerSample, setWriterSample] = useState('');
	const [output, setOutput] = useState('');
	const [metrics, setMetrics] = useState<MetricsPair | null>(null);
	const [analysis, setAnalysis] = useState<EeatAnalysis | null>(null);
	const [publication, setPublication] = useState<PublicationReadiness | null>(null);
	const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);
	const [qualityText, setQualityText] = useState('');
	const [warning, setWarning] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [history, setHistory] = useState<HistoryEntry[]>([]);

	useEffect(() => {
		const storedHistory = loadHistory();
		const storedProfile = loadAuthorProfile();
		if (storedHistory.length > 0 || storedProfile) {
			// eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client storage hydration
			setHistory(storedHistory);
			if (storedProfile) setAuthorProfile(storedProfile);
		}
	}, []);

	function updateAuthorProfile(value: string) {
		setAuthorProfile(value);
		saveAuthorProfile(value);
	}

	async function handleRun() {
		setError(null);
		setWarning(null);
		const validationError = validateInput(input);
		if (validationError) {
			setError(validationError);
			return;
		}

		const preserveSource = (
			message = 'این بار بازنویسی کامل نشد؛ متن اصلی شما حفظ شده است و می‌توانید دوباره تلاش کنید.',
		) => {
			setOutput(input);
			setQualityText(input);
			setPublication({ status: 'needs-work', blockers: [] });
			setWarning(message);
			setError(null);
		};
		if (activeRequest.current) return;
		const controller = new AbortController();
		activeRequest.current = controller;
		setLoading(true);
		setStatusMessage('در حال اتصال به موتور بازنویسی…');
		setOutput('');
		setMetrics(null);
		setAnalysis(null);
		setPublication(null);
		setQualityReport(null);

		try {
			const terms = keywords
				.split(/[,،\n]+/)
				.map(term => term.trim())
				.filter(Boolean);
			const response = await fetch('/api/humanize', {
				method: 'POST',
				signal: controller.signal,
				headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
				body: JSON.stringify({
					text: input,
					...(targetWords
						? { targetWords: Number(targetWords), wordTolerance: Number(wordTolerance) / 100 }
						: {}),
					voice,
					contentType,
					perspective,
					quality: qualityLevel,
					articleGoal,
					audience,
					sources,
					authorProfile,
					writerSample,
					notes,
					keywords: terms,
				}),
			});

			const contentTypeHeader = response.headers.get('content-type') ?? '';
			if (contentTypeHeader.includes('application/json') || !response.ok) {
				preserveSource();
				return;
			}

			let completed: HumanizeResponse | null = null;
			let streamError: string | null = null;
			await consumeSse(response, frame => {
				if (frame.event === 'step' && frame.data && typeof frame.data === 'object' && 'message' in frame.data) {
					const message = (frame.data as { message?: unknown }).message;
					if (typeof message === 'string') setStatusMessage(message);
					return;
				}
				if (frame.event === 'complete' && frame.data && typeof frame.data === 'object') {
					completed = frame.data as HumanizeResponse;
					return;
				}
				if (
					frame.event === 'error' &&
					frame.data &&
					typeof frame.data === 'object' &&
					'message' in frame.data
				) {
					const message = (frame.data as { message?: unknown }).message;
					streamError = typeof message === 'string' ? message : 'خطایی رخ داد. لطفاً دوباره تلاش کنید.';
				}
			});

			if (streamError) {
				preserveSource();
				return;
			}
			const data = completed as HumanizeResponse | null;
			const resultText = data?.text;
			if (!data || typeof resultText !== 'string') {
				preserveSource();
				return;
			}

			setOutput(resultText);
			setQualityReport(data.quality ?? null);
			setQualityText(resultText);
			setMetrics(data.metrics ?? null);
			setAnalysis(data.analysis ?? null);
			setPublication(data.publication ?? null);
			if (data.warning) setWarning(data.warning);

			const entry: HistoryEntry = {
				id: crypto.randomUUID(),
				original: input,
				result: resultText,
				createdAt: Date.now(),
				...(targetWords
					? { targetWords: Number(targetWords), wordTolerance: Number(wordTolerance) / 100 }
					: {}),
				voice,
				contentType,
				perspective,
				qualityLevel,
				articleGoal,
				audience,
				sources,
				writerSample,
				notes,
				keywords: terms,
				...(data.quality ? { quality: data.quality } : {}),
			};
			const nextHistory = [entry, ...history].slice(0, 5);
			setHistory(nextHistory);
			saveHistory(nextHistory);
		} catch {
			if (controller.signal.aborted) {
				preserveSource('پردازش لغو شد؛ متن اصلی شما حفظ شده است.');
				return;
			}
			preserveSource();
		} finally {
			activeRequest.current = null;
			setLoading(false);
			setStatusMessage(null);
		}
	}

	function handleRestore(entry: HistoryEntry) {
		setInput(entry.original);
		setTargetWords(entry.targetWords ? String(entry.targetWords) : '');
		setWordTolerance(String(Math.round((entry.wordTolerance ?? 0.1) * 100)));
		setOutput(entry.result);
		setVoice(entry.voice && VOICES.includes(entry.voice) ? entry.voice : 'standard');
		setContentType(entry.contentType && CONTENT_TYPES.includes(entry.contentType) ? entry.contentType : 'general');
		setPerspective(
			entry.perspective && PERSPECTIVES.includes(entry.perspective) ? entry.perspective : 'third_person',
		);
		setQualityLevel(
			entry.qualityLevel && QUALITY_LEVELS.includes(entry.qualityLevel) ? entry.qualityLevel : 'readable',
		);
		setNotes(entry.notes ?? '');
		setArticleGoal(entry.articleGoal ?? '');
		setAudience(entry.audience ?? '');
		setSources(entry.sources ?? '');
		setWriterSample(entry.writerSample ?? '');
		const storedQuality = entry.quality;
		setQualityReport(
			storedQuality?.voice && storedQuality?.contentType && storedQuality?.qualityLevel ? storedQuality : null,
		);
		setQualityText(entry.result);
		setKeywords(entry.keywords?.join('، ') ?? '');
		setAnalysis(null);
		setPublication(null);
		setError(null);
		setWarning(null);
		import('@/lib/stylometry').then(({ computeStyleMetrics }) => {
			setMetrics({ before: computeStyleMetrics(entry.original), after: computeStyleMetrics(entry.result) });
		});
	}

	function handleClearHistory() {
		clearHistory();
		setHistory([]);
	}

	const edited = Boolean(output && qualityText && output !== qualityText);
	const visibleAnalysis = useMemo(() => reconcileAnalysisWithText(analysis, output), [analysis, output]);
	const visiblePublication = useMemo(() => {
		if (!publication || !edited || !qualityReport) return publication;
		const terms = keywords
			.split(/[,،\n]+/)
			.map(term => term.trim())
			.filter(Boolean);
		const currentScore = judgeLocally(
			{
				text: input,
				voice,
				contentType,
				perspective,
				quality: qualityLevel,
				...(targetWords
					? { targetWords: Number(targetWords), wordTolerance: Number(wordTolerance) / 100 }
					: {}),
				articleGoal,
				audience,
				sources,
				authorProfile,
				writerSample,
				notes,
				keywords: terms,
			},
			output,
		);
		return assessPublicationReadiness({
			text: output,
			analysis: visibleAnalysis,
			writingReviewRequired: currentScore.verdict !== 'pass',
		});
	}, [
		publication,
		edited,
		qualityReport,
		keywords,
		input,
		voice,
		contentType,
		perspective,
		qualityLevel,
		targetWords,
		wordTolerance,
		articleGoal,
		audience,
		sources,
		authorProfile,
		writerSample,
		notes,
		output,
		visibleAnalysis,
	]);

	const canSubmit = mounted && !loading && input.trim().length > 0 && input.length <= MAX_INPUT_CHARS;

	return (
		<div id='workspace' className='flex scroll-mt-32 flex-col gap-12'>
			<div className='fade-up fade-up-d1 flex flex-wrap items-center justify-between gap-4 px-1'>
				<div className='flex items-center gap-3'>
					<span aria-hidden='true' className='step-badge'>
						۰۱
					</span>
					<div>
						<p className='section-kicker'>فضای کار</p>
						<h2 className='section-title'>لحن و دقت را تنظیم کنید</h2>
					</div>
				</div>
			</div>

			<div className='paper-panel fade-up fade-up-d2 relative p-8 sm:p-10'>
				<div className='mb-4 flex flex-wrap items-center justify-between gap-2'>
					<div>
						<p className='text-sm font-medium text-off-black'>لحن متن</p>
						<p className='mt-1 text-sm text-smoke'>نحوه حرف‌زدن متن را انتخاب کنید.</p>
					</div>
				</div>
				<VoiceSelector value={voice} onChange={setVoice} disabled={loading} />
				<div className='mt-5 grid gap-4 sm:grid-cols-3'>
					<div className='field-label'>
						<span id='perspective-label'>زاویه دید روایت</span>
						<Select
							value={perspective}
							options={PERSPECTIVE_OPTIONS}
							onChange={setPerspective}
							disabled={loading}
							labelledBy='perspective-label'
						/>
					</div>
					<label className='field-label'>
						تعداد کلمات هدف (اختیاری)
						<input
							type='number'
							min={100}
							max={3000}
							step={1}
							value={targetWords}
							onChange={event => setTargetWords(event.target.value)}
							disabled={loading}
							placeholder='مثلاً ۱۵۰۰؛ خالی یعنی حفظ طول متن'
							className='field'
						/>
					</label>
					<label className='field-label'>
						تلورانس طول (درصد)
						<input
							type='number'
							min={5}
							max={25}
							step={1}
							value={wordTolerance}
							onChange={event => setWordTolerance(event.target.value)}
							disabled={loading || !targetWords}
							className='field'
						/>
					</label>
				</div>
				<EditorialControls
					contentType={contentType}
					quality={qualityLevel}
					onContentTypeChange={setContentType}
					onQualityChange={setQualityLevel}
					disabled={loading}
				/>
			</div>

			<Disclosure title='زمینه و صدای نویسنده' hint='اختیاری، اما مؤثر'>
				<div className='grid gap-5 border-t border-ash p-5 sm:grid-cols-2 sm:p-6'>
					<label className='field-label'>
						هدف و پرسش اصلی مقاله
						<textarea
							value={articleGoal}
							onChange={event => setArticleGoal(event.target.value)}
							disabled={loading}
							maxLength={MAX_CONTEXT_CHARS}
							dir='rtl'
							rows={2}
							placeholder='پاسخ کلیدی یا دستاورد نهایی که خواننده باید از این مطلب بگیرد...'
							className='field resize-y leading-7'
						/>
					</label>
					<label className='field-label'>
						مخاطب
						<textarea
							value={audience}
							onChange={event => setAudience(event.target.value)}
							disabled={loading}
							maxLength={MAX_CONTEXT_CHARS}
							dir='rtl'
							rows={2}
							placeholder='مثلاً مدیر فروشگاه اینترنتی که اولین کمپینش را می سازد'
							className='field resize-y leading-7'
						/>
					</label>
					<label className='field-label'>
						منابع واقعی
						<textarea
							value={sources}
							onChange={event => setSources(event.target.value)}
							disabled={loading}
							maxLength={MAX_CONTEXT_CHARS}
							dir='rtl'
							rows={3}
							placeholder='لینک مستندات رسمی، گزارش‌های پژوهشی یا ارجاعات معتبر'
							className='field resize-y leading-7'
						/>
					</label>
					<label className='field-label'>
						تجربه ها و نکات واقعی شما
						<textarea
							value={notes}
							onChange={event => setNotes(event.target.value)}
							disabled={loading}
							maxLength={MAX_CONTEXT_CHARS}
							dir='rtl'
							rows={3}
							placeholder='مشاهدات تجربی، خطاهای حین تست یا جزئیاتی که افراد از آن‌ها بی‌خبرند ...'
							className='field resize-y leading-7'
						/>
					</label>
					<label className='field-label'>
						پروفایل نویسنده
						<textarea
							value={authorProfile}
							onChange={event => updateAuthorProfile(event.target.value)}
							disabled={loading}
							maxLength={MAX_CONTEXT_CHARS}
							dir='rtl'
							rows={2}
							placeholder='تخصص، نقش سازمانی یا زمینه حرفه‌ای مرتبط با موضوع مقاله...'
							className='field resize-y leading-7'
						/>
					</label>
					<label className='field-label'>
						نمونه نثر نویسنده
						<textarea
							value={writerSample}
							onChange={event => setWriterSample(event.target.value)}
							disabled={loading}
							maxLength={MAX_CONTEXT_CHARS}
							dir='rtl'
							rows={3}
							placeholder='یک یا دو پاراگراف از نوشته‌های قبلی خودتان را جای‌گذاری کنید تا ریتم و لحن قلم شما تقلید شود...'
							className='field resize-y leading-7'
						/>
					</label>
					<label className='field-label sm:col-span-2'>
						نام‌ها و کلیدواژه‌های ثابت
						<input
							value={keywords}
							onChange={event => setKeywords(event.target.value)}
							disabled={loading}
							maxLength={3630}
							dir='rtl'
							placeholder='نام برند، عبارت کلیدی یا چیزی که باید عیناً بماند'
							className='field'
						/>
					</label>
				</div>
			</Disclosure>

			<ContextReadiness
				articleGoal={articleGoal}
				audience={audience}
				sources={sources}
				notes={notes}
				authorProfile={authorProfile}
			/>

			<div className='flex items-center gap-3 px-1'>
				<span aria-hidden='true' className='step-badge'>
					۰۲
				</span>
				<div>
					<p className='section-kicker'>بازنویسی</p>
					<h2 className='section-title'>متن را وارد کنید و نتیجه را کنار آن ببینید</h2>
				</div>
			</div>

			<div className='grid gap-5 lg:grid-cols-2'>
				<TextInput
					value={input}
					onChange={setInput}
					disabled={loading}
					label='متن اصلی'
					placeholder='متن فارسی خود را اینجا بچسبانید…'
					headerAction={
						<div className='flex gap-2'>
							{loading ? (
								<button
									type='button'
									onClick={() => activeRequest.current?.abort()}
									className='secondary-button px-3 text-xs'
								>
									<Icon name='spinner' className='size-4' />
									لغو پردازش
								</button>
							) : (
								<>
									{input && (
										<button
											type='button'
											onClick={() => setInput('')}
											className='secondary-button px-3 text-xs'
										>
											پاک‌کردن
										</button>
									)}
									<button
										type='button'
										onClick={handleRun}
										disabled={!canSubmit}
										className='primary-button min-h-11 shrink-0 px-4 py-2 text-xs sm:min-w-36'
									>
										انسانی‌سازی
										<Icon name='arrow-go' className='size-4' />
									</button>
								</>
							)}
						</div>
					}
				/>
				{loading && (
					<p role='status' className='workspace-note lg:col-span-2 lg:row-start-2'>
						{statusMessage ?? 'پردازش ممکن است چند دقیقه طول بکشد. می‌توانید با دکمه لغو آن را متوقف کنید.'}
					</p>
				)}
				<div className='min-w-0 lg:col-start-2 lg:row-start-1'>
					<OutputPanel
						text={output}
						original={input}
						loading={loading}
						statusMessage={statusMessage}
						onChange={setOutput}
					/>
				</div>
			</div>

			{error && (
				<p
					role='alert'
					className='rounded-[24px] border border-coral/50 bg-review-wash px-5 py-4 text-sm font-medium leading-7 text-error-ink'
				>
					{error}
				</p>
			)}
			{warning && !error && <p className='workspace-note'>{warning}</p>}
			{visibleAnalysis && <EeatPanel analysis={visibleAnalysis} />}
			{visiblePublication && <PublicationStrip publication={visiblePublication} />}
			{qualityReport && <QualityStrip quality={qualityReport} edited={edited} />}
			{metrics && <MetricsPanel metrics={metrics} />}
			<HistoryList entries={history} onRestore={handleRestore} onClear={handleClearHistory} />
		</div>
	);
}
