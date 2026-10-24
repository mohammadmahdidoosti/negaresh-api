import { validateLengthOptions } from '@/lib/length';
import { readBoundedJson, RequestBodyError } from '@/lib/request-body';
/**
 * POST /api/humanize
 * Validates the editorial payload, enforces client rate limits, and streams the rewrite pipeline over SSE.
 */

import { analyzeEeat, createExecutionContext, HumanizerError, rewriteText } from '@/lib/humanizer';
import type { LintReport } from '@/lib/linter';
import { assessPublicationReadiness } from '@/lib/publication';
import { computeStyleMetrics } from '@/lib/stylometry';
import { validateInput } from '@/lib/text';
import {
	CONTENT_TYPES,
	MAX_CONTEXT_CHARS,
	MAX_INPUT_CHARS,
	MAX_TOTAL_CONTEXT_CHARS,
	PERSPECTIVES,
	QUALITY_LEVELS,
	VOICES,
	type HumanizeRequest,
	type HumanizeResponse,
	type LintSignalSummary,
} from '@/lib/types';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 200;

const RATE_LIMIT_MAX_REQUESTS = 25;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(clientKey: string): { limited: boolean; retryAfterSeconds: number } {
	const now = Date.now();
	const bucket = rateBuckets.get(clientKey);

	if (!bucket || bucket.resetAt <= now) {
		rateBuckets.set(clientKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
		return { limited: false, retryAfterSeconds: 0 };
	}

	bucket.count += 1;
	if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
		return {
			limited: true,
			retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
		};
	}
	return { limited: false, retryAfterSeconds: 0 };
}

function evictExpiredBuckets(): void {
	const now = Date.now();
	for (const [key, bucket] of rateBuckets) {
		if (bucket.resetAt <= now) rateBuckets.delete(key);
	}
}

function parseEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function parseContext(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function lintSummary(report: LintReport): LintSignalSummary {
	return {
		fluffDensity: report.fluffDensity,
		burstiness: report.burstiness,
		errorWeight: report.errorWeight,
		warnWeight: report.warnWeight,
		needsRefinement: report.needsRefinement,
		blocking: report.blocking,
		passesBudget: report.passesBudget,
		violationCount: report.violations.length,
	};
}

function encodeSse(event: string, data: unknown): Uint8Array {
	return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sseResponse(stream: ReadableStream<Uint8Array>): Response {
	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
		},
	});
}

export async function POST(request: Request) {
	let body: unknown;
	try {
		body = await readBoundedJson(request);
	} catch (error) {
		if (error instanceof RequestBodyError)
			return NextResponse.json({ error: error.message }, { status: error.status });
		return NextResponse.json({ error: 'درخواست نامعتبر است.' }, { status: 400 });
	}

	if (typeof body !== 'object' || body === null) {
		return NextResponse.json({ error: 'درخواست نامعتبر است.' }, { status: 400 });
	}

	const {
		text,
		voice,
		contentType,
		perspective,
		quality,
		articleGoal,
		audience,
		sources,
		notes,
		authorProfile,
		writerSample,
		keywords,
		targetWords,
		wordTolerance,
	} = body as Record<string, unknown>;

	if (typeof text !== 'string') {
		return NextResponse.json({ error: 'متن ارسال‌شده نامعتبر است.' }, { status: 400 });
	}

	if (text.length > MAX_INPUT_CHARS * 2) {
		return NextResponse.json({ error: 'متن ارسال‌شده بیش از حد مجاز است.' }, { status: 413 });
	}

	const validationError = validateInput(text) || validateLengthOptions(targetWords, wordTolerance);
	if (validationError) {
		return NextResponse.json({ error: validationError }, { status: 400 });
	}

	const forwarded = request.headers.get('x-forwarded-for');
	const clientKey = forwarded?.split(',')[0]?.trim() ?? 'local';
	const { limited, retryAfterSeconds } = isRateLimited(clientKey);

	if (limited) {
		return NextResponse.json(
			{
				error: `تعداد درخواست‌های شما زیاد است. لطفاً پس از ${Math.ceil(retryAfterSeconds / 60).toLocaleString(
					'fa-IR',
				)} دقیقه دوباره تلاش کنید.`,
			},
			{
				status: 429,
				headers: { 'Retry-After': String(retryAfterSeconds) },
			},
		);
	}

	if (rateBuckets.size > 200) evictExpiredBuckets();

	const voiceValue = parseEnum(voice, VOICES, 'standard');
	const contentTypeValue = parseEnum(contentType, CONTENT_TYPES, 'general');
	const perspectiveValue = parseEnum(perspective, PERSPECTIVES, 'third_person');
	const qualityValue = parseEnum(quality, QUALITY_LEVELS, 'readable');

	const context = {
		articleGoal: parseContext(articleGoal),
		audience: parseContext(audience),
		sources: parseContext(sources),
		notes: parseContext(notes),
		authorProfile: parseContext(authorProfile),
		writerSample: parseContext(writerSample),
	};

	if (
		[articleGoal, audience, sources, notes, authorProfile, writerSample].some(
			value => typeof value === 'string' && value.length > MAX_CONTEXT_CHARS,
		)
	) {
		return NextResponse.json(
			{
				error: `طول هر فیلد زمینه نباید از ${MAX_CONTEXT_CHARS.toLocaleString('fa-IR')} نویسه بیشتر باشد.`,
			},
			{ status: 400 },
		);
	}

	if (Object.values(context).reduce((sum, value) => sum + (value?.length ?? 0), 0) > MAX_TOTAL_CONTEXT_CHARS) {
		return NextResponse.json(
			{ error: `مجموع فیلدهای زمینه نباید از ${MAX_TOTAL_CONTEXT_CHARS} نویسه بیشتر باشد.` },
			{ status: 400 },
		);
	}

	if (
		keywords !== undefined &&
		(!Array.isArray(keywords) ||
			keywords.length > 30 ||
			keywords.some(term => typeof term !== 'string' || !term.trim() || term.length > 120))
	) {
		return NextResponse.json(
			{ error: 'حداکثر ۳۰ کلیدواژه، هر کدام بین ۱ تا ۱۲۰ نویسه، مجاز است.' },
			{ status: 400 },
		);
	}

	const payload: HumanizeRequest = {
		text,
		...(targetWords !== undefined
			? { targetWords: targetWords as number, wordTolerance: (wordTolerance as number | undefined) ?? 0.1 }
			: {}),
		voice: voiceValue,
		contentType: contentTypeValue,
		perspective: perspectiveValue,
		quality: qualityValue,
		...context,
		keywords: (keywords as string[] | undefined)?.map(term => term.trim()),
	};

	const upstream = new AbortController();
	const execution = createExecutionContext(upstream.signal);
	let closed = false;
	const disconnected = () => upstream.abort(request.signal.reason);
	request.signal.addEventListener('abort', disconnected, { once: true });
	if (request.signal.aborted) disconnected();
	return sseResponse(
		new ReadableStream({
			async start(controller) {
				const emit = (event: string, data: unknown) => {
					if (!closed && !request.signal.aborted) controller.enqueue(encodeSse(event, data));
				};
				const timeout = setTimeout(
					() => upstream.abort(new DOMException('Request deadline reached', 'TimeoutError')),
					570_000,
				);
				const heartbeat = setInterval(() => emit('heartbeat', {}), 15_000);
				let availableText = text;
				let hasDraft = false;
				try {
					const {
						analysis: reviewedAnalysis,
						text: rewritten,
						quality: qualityReport,
						validation,
						lint,
						surfaceFixes,
					} = await rewriteText(
						payload,
						(stage, message) => {
							emit('step', { stage, message });
						},
						execution,
					);
					availableText = rewritten;
					hasDraft = true;
					const metrics = {
						before: computeStyleMetrics(text),
						after: qualityReport.final.metrics,
					};

					const warnings: string[] = [...qualityReport.warnings];
					const writingReviewRequired = qualityReport.humanReviewRequired;

					const analysis = reviewedAnalysis ?? (await analyzeEeat(rewritten, payload, execution));
					if (!analysis) {
						warnings.push('بازنویسی انجام شد، اما تحلیل E-E-A-T در دسترس نبود.');
					}

					const publication = assessPublicationReadiness({
						text: rewritten,
						analysis,
						writingReviewRequired,
					});

					qualityReport.humanReviewRequired = writingReviewRequired || publication.status === 'needs-work';

					if (qualityReport.refineRan && (qualityReport.initial.lint?.violationCount ?? 0) > 0) {
						warnings.push(
							`اصلاح هدفمند: ${qualityReport.initial.lint!.violationCount.toLocaleString('fa-IR')} مورد تشخیصی بازبینی شد.`,
						);
					} else if (surfaceFixes > 0) {
						warnings.push(
							`نرمال‌سازی سطحی: ${surfaceFixes.toLocaleString('fa-IR')} اصلاح فاصله یا علائم نگارشی اعمال شد.`,
						);
					}

					const complete: HumanizeResponse = {
						text: rewritten,
						metrics,
						analysis,
						publication,
						quality: qualityReport,
						validation,
						lint: lintSummary(lint),
						...(warnings.length > 0 && { warning: warnings.join(' ') }),
					};
					emit('complete', complete);
				} catch (error) {
					if (upstream.signal.aborted) {
						// User cancellation is a normal outcome; private accounting retains its attempt.
					} else if (error instanceof HumanizerError) {
						console.error(
							'[api/humanize] humanizer error:',
							JSON.stringify({ status: error.status, message: error.message }),
						);
					} else {
						console.error('[api/humanize] unexpected error:', error);
					}
					emit('complete', {
						text: availableText,
						analysis: null,
						publication: { status: 'needs-work', blockers: ['analysis_unavailable'] },
						warning: hasDraft
							? 'متن آماده است؛ بازبینی نهایی کامل نشد. لطفاً پیش از انتشار یک بار آن را مرور کنید.'
							: 'این بار بازنویسی کامل نشد؛ متن اصلی شما حفظ شده است و می‌توانید دوباره تلاش کنید.',
					});
				} finally {
					clearTimeout(timeout);
					clearInterval(heartbeat);
					request.signal.removeEventListener('abort', disconnected);
					if (!closed) {
						closed = true;
						controller.close();
					}
				}
			},
			cancel() {
				closed = true;
				upstream.abort(new DOMException('Client canceled', 'AbortError'));
			},
		}),
	);
}
