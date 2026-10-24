import type { NarrativePerspective } from "../types";

const experienceGrounding = `
- **Evidence Gate (Overrides Narrative Style)**: First-person perspective is a stylistic preference, never evidence that the author performed an action. If the source contains no personal experience cues and no authorNotes or authorProfile are provided, keep takeaways objective or use general observational framing. Write "طبق داده متن، تأخیر 15% کاهش یافت", NOT "من تست کردم و دیدم تأخیر 15% کاهش یافت".
- **Claim-Level Grounding**: Even when notes, a profile, or personal experience cues exist, each claimed action must be explicitly supported and attributable to this author or team. A job title alone does not prove a test occurred. Never convert another person's experience, generic instructions, or a hypothetical example into the author's own history.
- **No Invented Biography**: Do not add employment history, credentials, clients, laboratories, experiments, years of experience, or team membership. writerSample is only a style reference and supplies no biographical evidence.
`;

export function getPerspectiveSkill(perspective?: NarrativePerspective): string {
  if (perspective === "first_person_singular") {
    return `
### NARRATIVE PERSPECTIVE: FIRST-PERSON PRACTITIONER ("من")
- **Active Voice & First-Person Agency**: Use "من" for actions the source or trusted context explicitly attributes to the author.
- **Grounded Anecdotes**: Preserve documented practitioner experiences; keep technical steps and findings objective when personal execution is not documented.
${experienceGrounding}
- **Avoid Hollow Egotism**:
  * STRICTLY FORBIDDEN: Passive/shallow qualifiers like "به نظر من", "من معتقدم", "احساس می‌کنم".
  * WHEN DOCUMENTED: Use concrete action verbs like "تست کردم", "بررسی کردم", "در عمل دیدم", "کانفیگ را تغییر دادم" only for supported personal actions.
- **Preserve Factual Invariants**: Keep numbers, direction of change, bounds, negation, URLs and technical tokens intact. "Latency dropped by 15%" can become "تأخیر 15% کاهش یافت" without adding a test or personal action.
- **Strict Anti-Hallucination**: Do not invent non-existent company names, fake personal credentials, or fictional case studies. Narrative preference never overrides factual grounding.
`;
  }

  if (perspective === "first_person_plural") {
    return `
### NARRATIVE PERSPECTIVE: FIRST-PERSON PLURAL TEAM ("ما")
- **Collaborative Agency**: Use "ما" only for actions explicitly attributed to the author's team by the source or trusted context.
- **Grounded Team Execution**: Describe collective workflows and tested setups only when documented; otherwise keep findings objective.
${experienceGrounding}
- **Maintain Invariants**: Keep all numbers, metrics, URLs, and English technical tokens strictly intact.
`;
  }

  return "";
}
