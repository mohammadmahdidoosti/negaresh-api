/** Copy Markdown as rich HTML and plain text, with a brief confirmation. */

'use client';

import { useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/ui/Icon';
import { useMounted } from '@/hooks/useMounted';
import { safeHtmlToPlainText, toRichTextClipboardHtml } from '@/lib/markdown-renderer';

interface CopyButtonProps {
	text: string;
	html: string;
	disabled?: boolean;
}

/** Synchronous rich-copy fallback for browsers that reject ClipboardItem. */
function writeWithCopyEvent(html: string, plainText: string) {
	const textarea = document.createElement('textarea');
	textarea.value = plainText;
	textarea.readOnly = true;
	textarea.setAttribute('aria-hidden', 'true');
	textarea.style.position = 'fixed';
	textarea.style.inset = '-9999px auto auto -9999px';
	document.body.appendChild(textarea);
	textarea.select();

	let wroteRichText = false;
	const handleCopy = (event: ClipboardEvent) => {
		if (!event.clipboardData) return;
		event.preventDefault();
		event.clipboardData.setData('text/html', html);
		event.clipboardData.setData('text/plain', plainText);
		wroteRichText = true;
	};

	document.addEventListener('copy', handleCopy);
	try {
		return document.execCommand('copy') && wroteRichText;
	} finally {
		document.removeEventListener('copy', handleCopy);
		textarea.remove();
	}
}

export default function CopyButton({ text, html, disabled }: CopyButtonProps) {
	const mounted = useMounted();
	const [copied, setCopied] = useState(false);
	const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const isDisabled = !mounted || disabled || !text;

	useEffect(
		() => () => {
			if (resetTimer.current) clearTimeout(resetTimer.current);
		},
		[],
	);

	async function handleCopy() {
		const richHtml = toRichTextClipboardHtml(html);
		const plainText = safeHtmlToPlainText(html);

		try {
			if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
				throw new Error('Rich clipboard is not supported.');
			}

			const clipboardItem = new ClipboardItem({
				'text/html': Promise.resolve(new Blob([richHtml], { type: 'text/html' })),
				'text/plain': Promise.resolve(new Blob([plainText], { type: 'text/plain' })),
			});

			await navigator.clipboard.write([clipboardItem]);
		} catch {
			let copiedWithEvent = false;
			try {
				copiedWithEvent = writeWithCopyEvent(richHtml, plainText);
			} catch {
				// Continue to the plain-text Clipboard API fallback below.
			}

			if (copiedWithEvent) {
				setCopyConfirmation();
				return;
			}

			try {
				if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is not supported.');
				await navigator.clipboard.writeText(plainText);
			} catch (error) {
				console.error('کپی ناموفق بود', error);
				return;
			}
		}

		setCopyConfirmation();
	}

	function setCopyConfirmation() {
		setCopied(true);
		if (resetTimer.current) clearTimeout(resetTimer.current);
		resetTimer.current = setTimeout(() => setCopied(false), 2000);
	}

	return (
		<button
			type='button'
			onClick={handleCopy}
			disabled={isDisabled}
			className='outline-button'
			aria-live='polite'
		>
			{copied ? (
				<>
					<Icon name='check' className='size-4' /> کپی شد
				</>
			) : (
				<>
					<Icon name='copy' className='size-4' /> کپی
				</>
			)}
		</button>
	);
}
