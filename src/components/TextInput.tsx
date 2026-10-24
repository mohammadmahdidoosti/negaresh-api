/** Input panel: large RTL textarea with live stats and the 10k-char guard. */

'use client';

import type { ReactNode } from 'react';

import { MAX_INPUT_CHARS } from '@/lib/types';
import TextStats from './TextStats';

interface TextInputProps {
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	/** Visible label and accessible name for the source editor. */
	label?: string;
	placeholder?: string;
	headerAction?: ReactNode;
}

export default function TextInput({
	value,
	onChange,
	disabled,
	label = 'متن اصلی',
	placeholder = 'متن فارسی خود را اینجا بچسبانید…',
	headerAction,
}: TextInputProps) {
	const overLimit = value.length > MAX_INPUT_CHARS;

	return (
		<section className='editor-paper editor-paper-input'>
			<div className='editor-paper-header input-editor-header'>
				<div className='min-w-0'>
					<span className='section-kicker'>ورودی</span>
					<h2 className='panel-heading'>{label}</h2>
				</div>
				<div className='editor-toolbar input-editor-toolbar'>
					<div className='input-editor-stats'>
						<TextStats text={value} showLimit />
					</div>
					<div className='input-editor-actions shrink-0'>{headerAction}</div>
				</div>
			</div>
			<textarea
				value={value}
				onChange={event => onChange(event.target.value)}
				disabled={disabled}
				dir='rtl'
				autoComplete='off'
				autoCorrect='off'
				autoCapitalize='off'
				spellCheck={false}
				data-gramm='false'
				data-gramm_editor='false'
				data-enable-grammarly='false'
				placeholder={placeholder}
				rows={10}
				className='editor-text selection:bg-lake-blue selection:text-white'
				aria-label={`${label} برای پردازش`}
			/>
			{overLimit && (
				<p className='border-t border-coral/30 bg-review-wash px-5 py-3 text-xs font-medium text-error-ink'>
					متن بیش از حد مجاز است. حداکثر {MAX_INPUT_CHARS.toLocaleString('fa-IR')} کاراکتر.
				</p>
			)}
		</section>
	);
}
