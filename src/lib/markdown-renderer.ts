import DOMPurify from 'isomorphic-dompurify';
import { Marked } from 'marked';

const placeholderPattern = /^\[\[[^\]\n]+\]\]/;

function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');
}

const markdownParser = new Marked({
	breaks: true,
	gfm: true,
});

markdownParser.use({
	extensions: [
		{
			name: 'placeholder',
			level: 'inline',
			start(source) {
				return source.indexOf('[[');
			},
			tokenizer(source) {
				const match = placeholderPattern.exec(source);
				if (!match) return;

				return {
					type: 'placeholder',
					raw: match[0],
					text: match[0],
				};
			},
			renderer(token) {
				return `<span class="marker-highlight" title="جای‌گذار برای تکمیل با اطلاعات واقعی نویسنده">${escapeHtml(
					token.text,
				)}</span>`;
			},
		},
	],
});

/** Convert Markdown into a sanitized HTML fragment suitable for rendering and copying. */
export function markdownToSafeHtml(markdown: string) {
	const parsed = markdownParser.parse(markdown);
	if (typeof parsed !== 'string') {
		throw new TypeError('Async Markdown parsing is not supported.');
	}

	return DOMPurify.sanitize(parsed, {
		FORBID_ATTR: ['style'],
		FORBID_TAGS: ['style'],
		RETURN_TRUSTED_TYPE: false,
		USE_PROFILES: { html: true },
	});
}

const clipboardTagStyles: Record<string, string> = {
	h1: 'font-size:28px;font-weight:700;line-height:1.55;margin:0 0 18px;color:#242424',
	h2: 'font-size:22px;font-weight:700;line-height:1.6;margin:24px 0 12px;color:#242424',
	h3: 'font-size:18px;font-weight:700;line-height:1.7;margin:20px 0 10px;color:#242424',
	h4: 'font-size:16px;font-weight:700;line-height:1.8;margin:18px 0 8px;color:#242424',
	p: 'font-size:16px;line-height:2;margin:0 0 14px;color:#242424',
	ul: 'font-size:16px;line-height:2;margin:0 0 14px;padding:0 24px 0 0;color:#242424',
	ol: 'font-size:16px;line-height:2;margin:0 0 14px;padding:0 24px 0 0;color:#242424',
	li: 'font-size:16px;line-height:2;margin:0 0 4px;color:#242424',
	strong: 'font-weight:700;color:#242424',
	em: 'font-style:italic',
	blockquote:
		'font-size:16px;line-height:2;margin:18px 0;padding:4px 16px 4px 0;border-right:4px solid #a0b5eb;color:#4e4d4d',
	a: 'color:#2b59d1;text-decoration:underline',
	pre: 'direction:ltr;text-align:left;white-space:pre-wrap;font-family:monospace;margin:16px 0;padding:12px;background:#f3f3f3',
	code: 'font-family:monospace',
	table: 'width:100%;border-collapse:collapse;margin:16px 0;direction:rtl;text-align:right',
	th: 'font-weight:700;padding:8px;border:1px solid #cecac8',
	td: 'padding:8px;border:1px solid #cecac8',
};

function addClipboardInlineStyles(html: string) {
	return Object.entries(clipboardTagStyles).reduce(
		(styledHtml, [tag, style]) =>
			styledHtml.replace(new RegExp(`<${tag}(?=\\s|>)`, 'gi'), `<${tag} style="${style}"`),
		html,
	);
}

/** Create a self-contained RTL HTML clipboard document for editors such as Google Docs. */
export function toRichTextClipboardHtml(safeHtml: string) {
	const styledHtml = addClipboardInlineStyles(safeHtml).replace(
		/class="marker-highlight"/g,
		'style="color:#fff;background:#2b59d1;font-weight:500;padding:2px 6px;border-radius:6px"',
	);

	return [
		'<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"></head>',
		'<body dir="rtl" style="direction:rtl;text-align:right;font-family:Vazirmatn,Tahoma,Arial,sans-serif;color:#242424">',
		'<!--StartFragment--><div dir="rtl" style="direction:rtl;text-align:right">',
		styledHtml,
		'</div><!--EndFragment--></body></html>',
	].join('');
}

/** Derive readable plain text from sanitized HTML instead of exposing Markdown syntax. */
export function safeHtmlToPlainText(safeHtml: string) {
	const withBreaks = safeHtml
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<hr\s*\/?>/gi, '\n—\n')
		.replace(/<li(?=\s|>)[^>]*>/gi, '• ')
		.replace(/<\/(?:h[1-6]|p|div|blockquote|pre|li|tr)>/gi, '\n')
		.replace(/<\/(?:th|td)>/gi, '\t');
	const container = DOMPurify.sanitize(withBreaks, {
		ALLOWED_ATTR: [],
		ALLOWED_TAGS: [],
		RETURN_DOM: true,
	});

	return (container.textContent ?? '')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
