/** Shared contracts for the single-flow Persian Humanizer. */

export const VOICES = ['formal', 'standard', 'casual', 'roughcut'] as const;
export type Voice = (typeof VOICES)[number];

export const PERSPECTIVES = ['third_person', 'first_person_singular', 'first_person_plural'] as const;
export type NarrativePerspective = (typeof PERSPECTIVES)[number];

export const CONTENT_TYPES = [
	'general',
	'howto',
	'commercial',
	'news',
	'ymyl_health',
	'ymyl_money',
	'ymyl_legal_civic',
	'opinion',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const QUALITY_LEVELS = ['simple', 'readable', 'precise', 'strict'] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];

export const MAX_INPUT_CHARS = 40_000;
export const MAX_CONTEXT_CHARS = 6_000;

export const MAX_TOTAL_CONTEXT_CHARS = 18_000;
export const MAX_BODY_BYTES = 256_000;
export const MIN_TARGET_WORDS = 100;
export const MAX_TARGET_WORDS = 3_000;

export const WRITING_STAGES = ['invariants', 'drafting', 'validating', 'critic', 'refining'] as const;
export type WritingStage = (typeof WRITING_STAGES)[number];

export interface ValidationReport {
	hardMissingAnchors?: string[];
	softMissingAnchors?: string[];
	status?: "verified" | "review-recommended";
	missingAnchors: string[];
	passed: boolean;
	score: number;
}

export interface HumanizeRequest {
	/** Defaults to third_person when omitted or undefined. */
	perspective?: NarrativePerspective;
	text: string;
	targetWords?: number;
	wordTolerance?: number;
	voice: Voice;
	contentType: ContentType;
	quality: QualityLevel;
	articleGoal?: string;
	audience?: string;
	sources?: string;
	notes?: string;
	authorProfile?: string;
	writerSample?: string;
	keywords?: readonly string[];
}

export interface StyleMetrics {
	sentenceCount: number;
	meanSentenceWords: number;
	stdDevSentenceWords: number;
	shortSentenceShare: number;
	long25Share: number;
	long41Share: number;
	functionWordRatio: number;
	typeTokenRatio: number;
	clicheHits: number;
	zwnjDensity: number;
	wordCount: number;
	charCount: number;
}

export interface MetricsPair {
	before: StyleMetrics;
	after: StyleMetrics;
}

export type LocalVerdict = 'pass' | 'soft-fail' | 'hard-fail';
export const CRITIC_CODES = [
	'length_target',
	'low_effort_mc',
	'filler',
	'scaled_template',
	'missing_who_how_why',
	'unsourced_claim',
	'ymyl_overconfident',
	'too_smooth',
	'too_broken',
	'intent_delay',
	'thin_information_gain',
	'vague_attribution',
	'invalid_markdown',
	'stock_pattern',
	'meaning_drift',
	'fabricated_detail',
] as const;
export type CriticCode = (typeof CRITIC_CODES)[number];

export interface QualityIssue {
	code: CriticCode;
	fix: string;
}
export interface CriticResult {
	verdict: 'pass' | 'refine';
	issues: QualityIssue[];
	keep: string[];
}

export interface LintSignalSummary {
	fluffDensity: number;
	burstiness: number;
	errorWeight: number;
	warnWeight: number;
	needsRefinement: boolean;
	blocking: boolean;
	passesBudget: boolean;
	violationCount: number;
}

export interface LocalScorecard {
	verdict: LocalVerdict;
	metrics: StyleMetrics;
	lengthDelta: number | null;
	wordTarget?: { target: number; min: number; max: number; actual: number; passed: boolean };
	issues: QualityIssue[];
	meaningCheck: 'anchors-and-direction';
	typoEstimate: null;
	lint?: LintSignalSummary;
	editorialSignals?: {
		answerFirst: 'direct' | 'delayed' | 'not-assessed';
		vagueAttributionHits: number;
		groundedDepthPoints: number;
		requiredDepthPoints: number;
		symmetricList: boolean;
	};
}

export interface QualityReport {
	voice: Voice;
	contentType: ContentType;
	qualityLevel: QualityLevel;
	initial: LocalScorecard;
	final: LocalScorecard;
	criticRan: boolean;
	criticVerdict: 'pass' | 'refine' | 'unavailable' | null;
	refineRan: boolean;
	refinedIssueCodes?: CriticCode[];
	/** Writing-loop calls only; the separate E-E-A-T analysis call is excluded. */
	llmCalls: number;
	humanReviewRequired: boolean;
	warnings: string[];
}

export type EeatGapType = 'who' | 'how' | 'why' | 'experience';
export interface EeatGap {
	type: EeatGapType;
	title: string;
	detail: string;
}
export interface UnsourcedClaim {
	quote: string;
	reason: string;
}
export interface EeatPlaceholder {
	marker: string;
	label: string;
	guidance: string;
}
export interface EeatAnalysis {
	gaps: EeatGap[];
	unsourcedClaims: UnsourcedClaim[];
	placeholders: EeatPlaceholder[];
}

export const PUBLICATION_BLOCKERS = [
	'analysis_unavailable',
	'quality_review',
	'eeat_gap',
	'unsourced_claim',
	'unresolved_placeholder',
] as const;
export type PublicationBlocker = (typeof PUBLICATION_BLOCKERS)[number];

export type PublicationStatus = 'ready-for-human-review' | 'needs-work' | 'approved' | 'blocked';

export interface PublicationReadiness {
	status: PublicationStatus;
	blockers: PublicationBlocker[];
}

export interface HumanizeResponse {
	text?: string;
	error?: string;
	metrics?: MetricsPair;
	analysis?: EeatAnalysis | null;
	publication?: PublicationReadiness;
	quality?: QualityReport;
	validation?: ValidationReport;
	lint?: LintSignalSummary;
	warning?: string;
}

export interface HistoryEntry {
	targetWords?: number;
	wordTolerance?: number;
	perspective?: NarrativePerspective;
	id: string;
	original: string;
	result: string;
	createdAt: number;
	voice?: Voice;
	contentType?: ContentType;
	qualityLevel?: QualityLevel;
	quality?: QualityReport;
	keywords?: readonly string[];
	notes?: string;
	articleGoal?: string;
	audience?: string;
	sources?: string;
	writerSample?: string;
}
