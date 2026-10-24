import type { ContentType } from '../types';

export interface ContentTypeSkill {
	name: string;
	isYmyl: boolean;
	instruction: string;
}

export const contentTypeSkills: Record<ContentType, string> = {
	general: `
[Content Type: General Informative / Explanatory Article]
- Objective: Deliver an answer-first, direct explanation without opening fluff.
- Language Policy: Output MUST be natural, fluent Persian.
- Directness: Resolve the reader's core query in the very first sentence. Eliminate filler setups.
- Grounding: Draw examples strictly from the provided text. Keep secondary clauses only if they aid understanding.
- Invariants: Do not introduce fabricated trivia or unsourced background data.
`.trim(),

	howto: `
[Content Type: Step-by-Step Technical Guide / How-To]
- Objective: Provide immediate, actionable operational steps without editorial preambles.
- Language Policy: Output MUST be natural, fluent Persian. Voice determines colloquialness.
- UI Labels & Technical Terms: Strictly preserve exact English UI terms, buttons, and panel names verbatim (e.g., "Confirm", "Target", "Create a new ad") if they exist in source.
- Action Sequencing: Maintain precise action order, prerequisites, failure conditions, and warnings.
- Negative Constraints: Never fabricate personal anecdotes, setup steps, or unlisted software tools.
`.trim(),

	commercial: `
[Content Type: Product / Service Comparison & Commercial Intent]
- Objective: Clarify tangible value, limitations, trade-offs, and decision criteria.
- Language Policy: Output MUST be natural, fluent Persian.
- Negative Constraints: Strictly FORBIDDEN to fabricate customer reviews, ratings, benchmark scores, social proof, pricing, or unproven superiority claims.
- Scope: Sales and commercial claims must remain strictly bounded to the provided source context.
`.trim(),

	news: `
[Content Type: News Reporting & Current Events]
- Objective: Maintain journalistic integrity, distinguishing verified facts from commentary.
- Language Policy: Output MUST be natural, fluent Persian.
- Attribution (5W1H): Preserve exact persons, dates, locations, and source attributions.
- Verification Gate: Flag any unverified or unsourced assertion explicitly with "[[نیاز به منبع]]".
- Negative Constraints: Never invent quotes, chronological events, unnamed sources, or background context.
`.trim(),

	ymyl_health: `
[Content Type: Health & Medical (Google YMYL Strict)]
- Objective: Deliver cautious, medically grounded Persian text with zero tolerance for harm.
- Language Policy: Output MUST be natural, fluent Persian. Zero intentional typos or deliberate orthographic errors.
- Hedging: Actively soften ungrounded absolute certainty ("cure", "100% safe", "definitely treats"). Use hedged framing.
- Mandatory Marker: Any medical assertion lacking explicit clinical attribution MUST be tagged with "[[نیاز به منبع]]".
- Negative Constraints: NEVER invent dosages, clinical outcomes, patient testimonials, physicians, clinics, or pharmacology claims.
`.trim(),

	ymyl_money: `
[Content Type: Financial, Investment & Insurance (Google YMYL Strict)]
- Objective: Provide responsible financial communication without speculative certainty.
- Language Policy: Output MUST be natural, fluent Persian. Zero intentional typos.
- Risk Disclosure: Restrict definitive guarantees. Frame speculative returns as potential risks.
- Mandatory Marker: Flag unverified economic metrics, returns, or yields with "[[نیاز به منبع]]".
- Negative Constraints: NEVER fabricate yields, price forecasts, risk ratings, regulatory rules, or personal investment stories.
`.trim(),

	ymyl_legal_civic: `
[Content Type: Legal, Official Processes & Civic Procedures (Google YMYL Strict)]
- Objective: Precise informational guidance on legal or administrative steps.
- Language Policy: Output MUST be natural, fluent Persian. Zero intentional typos.
- Precision: Strictly preserve legal jurisdictions, statutory deadlines, dates, and official agency names.
- Mandatory Marker: Uncertain legal interpretations or unsourced deadlines must be tagged with "[[نیاز به منبع]]".
- Negative Constraints: NEVER invent statutes, court outcomes, rights, penalties, or procedural exceptions.
`.trim(),

	opinion: `
[Content Type: Editorial Opinion & Analysis]
- Objective: Articulate a distinct analytical viewpoint while respecting factual boundaries.
- Language Policy: Output MUST be natural, fluent Persian.
- Perspective Boundaries: Clearly distinguish subjective stances from empirical facts. Preserve the original author's attribution.
- Fairness: Represent counter-perspectives fairly without asserting opinion as indisputable fact.
- Negative Constraints: Never fabricate consensus, supporting studies, or fake corroborating evidence.
`.trim(),
};

export function isYmyl(contentType: ContentType): boolean {
	return contentType.startsWith('ymyl_');
}
