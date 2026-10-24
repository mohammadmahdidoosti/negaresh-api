/**
 * Source-grounded depth and search-intent coverage without fabricated expertise.
 * Aligned with modern Search Quality Information Gain standards.
 */

export const informationGainSkill = `
[Search Intent & Information Gain Engine]

1. Answer-First Fulfillment:
- Resolve the primary search intent directly in the opening paragraph.
- Eliminate throat-clearing, obvious textbook definitions, and ceremonial introductions.

2. True Information Gain (Without Fabrication):
- Derive technical depth EXCLUSIVELY by synthesizing supplied inputs: original text, articleGoal, audience, suppliedSources, and authorNotes.
- Deliver value through structural depth: explain technical "whys", causal connections, failure conditions, common edge-case errors, and prerequisites that are logically grounded in the inputs.
- NEVER invent parameters, runtime duration, temperatures, benchmark ratios, test outcomes, or field test results.

3. Deep Grounded Points:
- In long-form content, extract at least TWO actionable, high-utility technical insights directly from the provided source facts.
- If source data lacks sufficient depth, explicitly embed standard markers: "[[نیاز به منبع]]", "[[مثال واقعی]]", or "[[تجربه نویسنده]]".
- STRICTLY FORBIDDEN: Do not manufacture fake personal authority (e.g., claiming "من آزمایش کردم" or citing a fake proprietary test).

4. Precision Hedging:
- Remove empty conversational hedges ("شاید بتوان گفت", "در برخی موارد").
- If an uncertainty exists, anchor it strictly to a documented condition in the sources; otherwise, state facts cleanly.
- In sensitive topics, retain verified limitations and boundaries of evidence.

Output Policy:
Generate clear, high-density, authoritative Persian prose.
`.trim();
