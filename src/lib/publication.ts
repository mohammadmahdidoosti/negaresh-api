/** Pure publication-gate rules shared by the API and the editable client. */

import type {
  EeatAnalysis,
  PublicationBlocker,
  PublicationReadiness,
} from "./types";

const APPROVED_PLACEHOLDER = /\[\[(?:مثال واقعی|تجربه نویسنده|نیاز به منبع)\]\]/;

export interface PublicationAssessment {
  text: string;
  analysis: EeatAnalysis | null;
  writingReviewRequired: boolean;
}

/** Drop text-bound flags after the author removes or replaces their exact span. */
export function reconcileAnalysisWithText(
  analysis: EeatAnalysis | null,
  text: string,
): EeatAnalysis | null {
  if (!analysis) return null;
  return {
    gaps: analysis.gaps,
    unsourcedClaims: analysis.unsourcedClaims.filter((claim) => text.includes(claim.quote)),
    placeholders: analysis.placeholders.filter((placeholder) => text.includes(placeholder.marker)),
  };
}

export function assessPublicationReadiness({
  text,
  analysis,
  writingReviewRequired,
}: PublicationAssessment): PublicationReadiness {
  const currentAnalysis = reconcileAnalysisWithText(analysis, text);
  const blockers: PublicationBlocker[] = [];

  if (writingReviewRequired) blockers.push("quality_review");
  if (!currentAnalysis) blockers.push("analysis_unavailable");
  if (currentAnalysis?.gaps.length) blockers.push("eeat_gap");
  if (currentAnalysis?.unsourcedClaims.length) blockers.push("unsourced_claim");
  if (currentAnalysis?.placeholders.length || APPROVED_PLACEHOLDER.test(text)) {
    blockers.push("unresolved_placeholder");
  }

  return {
    status: blockers.length ? "needs-work" : "ready-for-human-review",
    blockers,
  };
}
