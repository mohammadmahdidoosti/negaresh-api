/** Output panel: rewritten text, a word-level diff toggle, copy and stats. */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { EmptyDocument } from '@/components/ui/Icon';
import { diffWords } from '@/lib/diff';
import { markdownToSafeHtml } from '@/lib/markdown-renderer';
import { ThinkingOrb } from 'thinking-orbs';
import CopyButton from './CopyButton';
import DownloadMarkdownButton from './DownloadMarkdownButton';
import TextStats from './TextStats';

interface OutputPanelProps {
	text: string;
	original: string;
	loading: boolean;
	statusMessage?: string | null;
	onChange: (text: string) => void;
}

type ViewMode = 'text' | 'edit' | 'diff';

const VIEW_MODES: { id: ViewMode; label: string }[] = [
	{ id: 'text', label: 'متن' },
	{ id: 'edit', label: 'ویرایش' },
	{ id: 'diff', label: 'تغییرات' },
];

function OutputSkeleton({ statusMessage }: { statusMessage?: string | null }) {
	return (
		<div className='flex h-full min-h-68 flex-col gap-5 py-1' role='status'>
			<div className='flex items-center gap-3 text-sm text-smoke'>
				<ThinkingOrb state='working' size={20} theme='light' />
				{statusMessage || 'در حال بازنویسی و بررسی متن…'}
			</div>
			<div className='flex flex-col gap-3 pt-2'>
				<div className='skeleton-line w-[94%]' />
				<div className='skeleton-line w-[82%]' />
				<div className='skeleton-line w-[88%]' />
				<div className='skeleton-line w-[70%]' />
				<div className='skeleton-line w-[76%]' />
				<div className='skeleton-line w-[58%]' />
			</div>
		</div>
	);
}

export default function OutputPanel({ text, original, loading, statusMessage, onChange }: OutputPanelProps) {
	const [viewMode, setViewMode] = useState<ViewMode>('text');
	const resultContainer = useRef<HTMLDivElement>(null);
	const renderedHtml = useMemo(() => (text ? markdownToSafeHtml(text) : ''), [text]);
	const diffParts = useMemo(
		() => (viewMode === 'diff' && text && !loading ? diffWords(original, text) : null),
		[viewMode, original, text, loading],
	);

	useEffect(() => {
		resultContainer.current?.scrollTo({ top: 0 });
	}, [text, viewMode]);

	return (
		<section className='editor-paper editor-paper-output'>
			<div className='editor-paper-header output-editor-header'>
				<div className='min-w-0'>
					<span className='section-kicker'>خروجی</span>
					<h2 className='panel-heading'>نسخه بازنویسی‌ شده</h2>
				</div>
				<div className='editor-toolbar output-editor-toolbar'>
					{text && (
						<div className='segmented output-view-switcher' role='group' aria-label='حالت نمایش خروجی'>
							{VIEW_MODES.map(mode => (
								<button
									key={mode.id}
									type='button'
									onClick={() => setViewMode(mode.id)}
									aria-pressed={viewMode === mode.id}
									className='choice-button min-h-11 px-3 py-2'
								>
									{mode.label}
								</button>
							))}
						</div>
					)}
					<div className='output-editor-actions'>
						<DownloadMarkdownButton text={text} disabled={loading} />
						<CopyButton text={text} html={renderedHtml} disabled={loading} />
					</div>
				</div>
			</div>

			<div ref={resultContainer} className='editor-result'>
				{loading ? (
					<OutputSkeleton statusMessage={statusMessage} />
				) : text ? (
					viewMode === 'edit' ? (
						<textarea
							value={text}
							onChange={event => onChange(event.target.value)}
							dir='rtl'
							autoComplete='off'
							autoCorrect='off'
							autoCapitalize='off'
							spellCheck={false}
							rows={10}
							aria-label='ویرایش متن بازنویسی شده'
							className='editor-text h-full !min-h-0 !px-0 !py-0'
						/>
					) : diffParts ? (
						<p className='whitespace-pre-wrap text-base leading-9 text-off-black'>
							{diffParts.map((part, index) =>
								part.type === 'same' ? (
									<span key={index}>{part.value}</span>
								) : part.type === 'add' ? (
									<span key={index} className='rounded bg-mint/50 text-off-black'>
										{part.value}
									</span>
								) : (
									<span
										key={index}
										className='rounded bg-coral/25 text-error-ink line-through decoration-coral'
									>
										{part.value}
									</span>
								),
							)}
						</p>
					) : (
						<article
							dir='rtl'
							aria-label='متن بازنویسی شده'
							className='markdown-output prose prose-neutral max-w-none text-right'
							dangerouslySetInnerHTML={{ __html: renderedHtml }}
						/>
					)
				) : (
					<div className='flex min-h-68 h-full flex-col items-center justify-center gap-5 text-center'>
						<div className='elevated-empty'>
							<EmptyDocument className='relative z-10 size-16 text-off-black' />
						</div>
						<div>
							<p className='text-base font-medium text-off-black'>نسخه تازه اینجا می‌آید</p>
							<p className='mt-2 max-w-64 text-sm leading-7 text-smoke'>
								متن را وارد کنید، لحن را بسازید و بازنویسی را شروع کنید.
							</p>
						</div>
					</div>
				)}
			</div>

			{text && !loading && (
				<div className='output-editor-footer border-t border-ash px-5 py-3'>
					<TextStats text={text} compareWith={original} />
				</div>
			)}
		</section>
	);
}
