import type { QualityLevel } from '../types';

/**
 * Editorial quality levels defining the depth of scrutiny,
 * structural pruning, and factual conservatism applied to the Persian output.
 */
export const qualitySkills: Record<QualityLevel, string> = {
	simple: `
[Quality Tier: Simple / Fast Draft]
- Objective: Provide a quick, usable, and direct rewrite with minimal editorial friction.
- Scrutiny: Focus strictly on cutting obvious AI clichés and opening filler. Do not over-polish or over-engineer sentence structures.
- Cadence: Allow natural, fluid phrasing. Do not introduce deliberate typographical errors.
`.trim(),

	readable: `
[Quality Tier: Readable / Balanced Web Standard]
- Objective: Achieve balanced, natural human flow with high clarity and zero fluff.
- Scrutiny: Prune redundant throat-clearing, balance sentence lengths naturally, and maintain all source details faithfully.
- Answer-First: Ensure the opening directly addresses the reader's intent before elaborating.
- Cleanliness: Zero deliberate spelling mistakes or mechanical degradation.
`.trim(),

	precise: `
[Quality Tier: Precise / Analytical Rigor]
- Objective: Tight, purposeful prose where every paragraph delivers measurable informational value.
- Scrutiny:
  * Clarify logical causality, explicit agents, and operational conditions.
  * Strictly eliminate monotone sentence openings, repetitive connectors, and symmetric paragraph blocks.
  * Zero tolerance for fabricated details or deliberate typing errors.
`.trim(),

	strict: `
[Quality Tier: Strict / Critical & YMYL Gate]
- Objective: Highest editorial conservatism, fully aligned with Google Search Quality Rater standards.
- Scrutiny:
  * Zero Fluff & Zero Empty Rhetoric: Eliminate speculative statements, marketing hype, and ungrounded certainty.
  * High-Risk Claim Bounding: Any unsubstantiated health, financial, or civic assertion must be conservatively hedged or explicitly flagged with "[[نیاز به منبع]]".
  * Verified Grounding: Every assertion must map directly to supplied context. Zero intentional typos.
`.trim(),
};
