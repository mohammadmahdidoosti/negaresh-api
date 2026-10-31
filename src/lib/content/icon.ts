/**
 * Category icons as small line SVGs written by a text model (experiment, 2026-10): one call per category, no image
 * API. The result is cleaned to a safe subset (no scripts, events, links or foreign content) before anyone sees it.
 */
import DOMPurify from 'isomorphic-dompurify';
import { createExecutionContext, generateText } from '@/lib/humanizer';

export const ICON_STYLE = {
  stroke: '#1f2a37',
  accent: '#e8792b',
};

export function iconMessages(name: string, hint?: string): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: `You draw simple, recognisable line icons for the product categories of an Iranian industrial supply store.
Output ONLY one SVG element, nothing else (no markdown fences, no explanation).
Rules:
- <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">, no width/height.
- One <g stroke="${ICON_STYLE.stroke}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"> holding the drawing.
- Only path, line, rect, circle, ellipse, polyline, polygon. No text, no gradients, no filters, no images, no fills.
- Exactly one key part in the accent colour: stroke="${ICON_STYLE.accent}" on that element.
- Keep 4 units of margin. At most about 12 elements: it must still read at 30 px.
- Draw the physical object as a technician would recognise it (side view), not a symbol or a letter.`,
    },
    { role: 'user', content: `Category: «${name}»${hint ? ` (${hint})` : ''}. Draw its icon.` },
  ];
}

/** The first <svg>…</svg> of a model answer, cleaned to drawing elements only; null when there is none. */
export function cleanSvg(raw: string): string | null {
  const m = raw.match(/<svg[\s\S]*?<\/svg>/i);
  if (!m) return null;
  const svg = DOMPurify.sanitize(m[0], {
    // an explicit list (a profile would add text, links and more back)
    ALLOWED_TAGS: ['svg', 'g', 'path', 'line', 'rect', 'circle', 'ellipse', 'polyline', 'polygon'],
    ALLOWED_ATTR: ['xmlns', 'viewBox', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points', 'transform',
      'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'fill', 'opacity'],
    KEEP_CONTENT: false,
    RETURN_TRUSTED_TYPE: false,
  }) as string;
  if (!/^<svg[\s>]/i.test(svg.trim()) || !/<(path|line|rect|circle|ellipse|polyline|polygon)\b/i.test(svg)) return null;
  return svg.includes('xmlns=') ? svg.trim() : svg.trim().replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
}

export const DEFAULT_ICON_MODEL = () => process.env.CONTENT_ICON_MODEL || 'deepseek/deepseek-v4-flash-0731';

export async function drawIcon(name: string, opts: { hint?: string; model?: string; signal?: AbortSignal } = {}): Promise<{ svg: string | null; raw: string; model: string }> {
  const model = opts.model || DEFAULT_ICON_MODEL();
  const raw = await generateText(iconMessages(name, opts.hint), {
    model,
    maxTokens: 3000,
    temperature: 0.4,
    stage: 'content-icon',
    useFallback: false,
    maxInputPrice: Number(process.env.CONTENT_MAX_INPUT_PRICE ?? '5'),
    maxOutputPrice: Number(process.env.CONTENT_MAX_OUTPUT_PRICE ?? '25'),
  }, createExecutionContext(opts.signal));
  return { svg: cleanSvg(raw), raw: raw.slice(0, 4000), model };
}
