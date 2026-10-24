import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tryNative: false });
const { markdownToSafeHtml, safeHtmlToPlainText, toRichTextClipboardHtml } = await jiti.import(
	'../src/lib/markdown-renderer.ts',
);

test('renders semantic Markdown and preserves placeholders', () => {
	const html = markdownToSafeHtml('# تیتر\n\n- متن **پررنگ**\n- [[نام نویسنده]]');

	assert.match(html, /<h1>تیتر<\/h1>/);
	assert.match(html, /<ul>/);
	assert.match(html, /<strong>پررنگ<\/strong>/);
	assert.match(html, /class="marker-highlight"/);
});

test('sanitizes unsafe Markdown HTML', () => {
	const html = markdownToSafeHtml(
		'<script>alert(1)</script><img src="x" onerror="alert(2)">\n\n[پیوند](javascript:alert(3))',
	);

	assert.doesNotMatch(html, /<script|onerror|javascript:/i);
});

test('creates a styled RTL clipboard document for rich-text editors', () => {
	const html = toRichTextClipboardHtml('<h2>عنوان</h2><p>متن <strong>مهم</strong></p>');

	assert.match(html, /^<!doctype html>/);
	assert.match(html, /<!--StartFragment-->/);
	assert.match(html, /dir="rtl"/);
	assert.match(html, /<h2 style="[^"]*font-size:22px/);
	assert.match(html, /<strong style="[^"]*font-weight:700/);
});

test('plain-text clipboard fallback contains no Markdown syntax', () => {
	const safeHtml = markdownToSafeHtml('# تیتر\n\nمتن **مهم**\n\n- مورد اول');
	const plainText = safeHtmlToPlainText(safeHtml);

	assert.match(plainText, /تیتر\n/);
	assert.match(plainText, /متن مهم/);
	assert.match(plainText, /• مورد اول/);
	assert.doesNotMatch(plainText, /#|\*\*/);
});
