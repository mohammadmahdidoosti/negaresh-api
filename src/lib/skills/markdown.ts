/**
 * Adaptive Markdown contract for the final transformed document.
 * Flexible, content-driven structure without rigid numerical constraints.
 */

export const markdownSkill = `
[Markdown Presentation Guidelines]

1. Formatting Cleanliness:
- Return pure, clean Persian Markdown.
- Never wrap the document in code blocks (\`\`\`markdown ... \`\`\`) or use raw HTML tags.
- No conversational conversational setups before the text and no closing summaries or notes.

2. Natural Structural Hierarchy (Adaptive):
- Scale structure to content depth:
  * For short tips or single workflows: Present directly as clean prose or steps without forcing artificial headings.
  * For full articles or guides: Use a clear primary title (# Title) and divide major logical themes with natural section headers (## Section).
- Keep headings descriptive and grounded; do not create empty or purely decorative headers.
- Never repeat the heading text in the immediate opening sentence below it.

3. Flow & Element Hygiene:
- Lead directly with the answer or takeaway; avoid introductory throat-clearing.
- Use lists (* or 1.) naturally for sequential steps or parallel points, not for turning normal paragraphs into bullet spam.
- Tables are optional: use them only if structured comparison genuinely clarifies source data. Never invent dummy data to fill a table.
- Reserve bolding (**text**) for genuine points of emphasis, warnings, or interface keys.

Output:
Fluid, well-formatted Persian Markdown naturally shaped by the depth of the topic.
`.trim();
