import { lengthInstruction, lengthPlan } from "./length";
import { combinedReviewSkill } from "./skills/combined-review";
/** Compose only the bounded skills needed for each model stage. */
import type { CriticResult, HumanizeRequest, LocalScorecard } from "./types";
import { coreSkill, embeddedContract, rewriteContract, textOnlyContract } from "./skills/core";
import {
  humanizeSkill,
  humanizerRefineSkill,
  humanizerReviewSkill,
} from "./skills/humanize";
import { analysisSkill, eeatSkill } from "./skills/eeat";
import { informationGainSkill } from "./skills/information-gain";
import { markdownSkill } from "./skills/markdown";
import { voiceSkills } from "./skills/voices";
import { contentTypeSkills } from "./skills/content-types";
import { qualitySkills } from "./skills/quality-levels";
import { criticSkill } from "./skills/critic";
import { refineSkill } from "./skills/refine";
import { getPerspectiveSkill } from "./skills/perspective";

export function buildGenerationSystemPrompt(req: HumanizeRequest): string {
  return [
    coreSkill,
    humanizeSkill,
    eeatSkill,
    informationGainSkill,
    voiceSkills[req.voice],
    contentTypeSkills[req.contentType],
    qualitySkills[req.quality],
    ...[getPerspectiveSkill(req.perspective)].filter(Boolean),
    markdownSkill,
    req.guards?.embedded ? embeddedContract : rewriteContract,
    ...guardInstructions(req),
    lengthInstruction(req),
  ].join("\n\n");
}

/** Opt-in guard rules; empty for the default web tool. */
function guardInstructions(req: HumanizeRequest): string[] {
  const out: string[] = [];
  if (req.guards?.noNewClaims) out.push("[No New Claims]\nDo not add any number, measurement, guarantee, warranty, \"best/only/100%\" superlative, free-shipping or price claim that is not already in the original. Rewording an existing claim is fine; strengthening it is not.");
  if (req.guards?.holdLength) out.push("[Length]\nKeep the rewrite at about the original length. Do not add new sections, examples or explanations; improve the wording of what is there.");
  return out;
}

/** JSON encoding keeps source and optional trusted context distinctly labelled. */
export function buildContext(req: HumanizeRequest): string {
  return JSON.stringify({
    voice: req.voice,
    contentType: req.contentType,
    perspective: req.perspective ?? "third_person",
    quality: req.quality,
    original: req.text,
    ...(req.targetWords ? { targetWords: req.targetWords, wordTolerance: req.wordTolerance ?? 0.1 } : {}),
    ...(req.targetWords ? { lengthPlan: lengthPlan(req) } : {}),
    trustedContext: {
      ...(req.articleGoal?.trim() ? { articleGoal: req.articleGoal.trim() } : {}),
      ...(req.audience?.trim() ? { audience: req.audience.trim() } : {}),
      ...(req.sources?.trim() ? { suppliedSources: req.sources.trim() } : {}),
      ...(req.authorProfile?.trim() ? { authorProfile: req.authorProfile.trim() } : {}),
      ...(req.notes?.trim() ? { authorNotes: req.notes.trim() } : {}),
    },
    ...(req.writerSample?.trim()
      ? { styleReference: { writerSample: req.writerSample.trim() } }
      : {}),
    ...(req.keywords?.length ? { exactKeywords: req.keywords } : {}),
  });
}

/** Context without the original text (surgical repair: the refiner must edit the candidate, not copy the source). */
function buildContextWithoutOriginal(req: HumanizeRequest): string {
  const ctx = JSON.parse(buildContext(req)) as Record<string, unknown>;
  delete ctx.original;
  return JSON.stringify(ctx);
}

export function buildSurgicalRefineUserPrompt(
  req: HumanizeRequest,
  candidate: string,
  critic: CriticResult,
  missing: Array<{ item: string; sourceSentence: string }>,
  lintViolations: Array<Record<string, unknown>> = [],
): string {
  return `${buildContextWithoutOriginal(req)}\n${JSON.stringify({
    candidate,
    issues: critic.issues.slice(0, 4),
    keep: critic.keep,
    ...(missing.length ? { missingFacts: missing } : {}),
    ...(lintViolations.length ? { lintViolations: lintViolations.slice(0, 8) } : {}),
    priorityEdit: 'Edit the candidate in place. Keep its wording, sentence order and style. For each missingFacts item, put the exact item back into the candidate sentence that covers the same point (use sourceSentence only to see where it belongs and what it means). Do not copy other sentences from sourceSentence. Fix the listed issues the same way: locally. Return the complete candidate.',
    editorialConstraints: { preserveAnchors: true, naturalSentenceRepair: true },
  })}`;
}

export function buildCriticSystemPrompt(req: HumanizeRequest, combined = false): string {
  return [
    coreSkill,
    humanizerReviewSkill,
    criticSkill,
    ...(combined ? [combinedReviewSkill] : []),
    ...(req.guards?.embedded ? ["[Embedded Section]\nThis text is a section inside a page that already has its own title. A missing # title is correct; a # heading is an invalid_markdown issue."] : []),
    ...guardInstructions(req),
    lengthInstruction(req),
    voiceSkills[req.voice],
    contentTypeSkills[req.contentType],
    qualitySkills[req.quality],
  ].join("\n\n");
}

export function buildCriticUserPrompt(
  req: HumanizeRequest,
  candidate: string,
  scorecard: LocalScorecard,
  lintViolations: Array<Record<string, unknown>> = [],
): string {
  return `${buildContext(req)}\n${JSON.stringify({
    candidate,
    scorecard,
    ...(lintViolations.length ? { lintViolations } : {}),
  })}`;
}

export function buildRefineSystemPrompt(req: HumanizeRequest): string {
  return [
    coreSkill,
    humanizerRefineSkill,
    refineSkill,
    voiceSkills[req.voice],
    contentTypeSkills[req.contentType],
    qualitySkills[req.quality],
    ...[getPerspectiveSkill(req.perspective)].filter(Boolean),
    markdownSkill,
    req.guards?.embedded ? embeddedContract : textOnlyContract,
    ...guardInstructions(req),
    lengthInstruction(req),
  ].join("\n\n");
}

export function buildRefineUserPrompt(
  req: HumanizeRequest,
  candidate: string,
  critic: CriticResult,
  lintViolations: Array<Record<string, unknown>> = [],
): string {
  return `${buildContext(req)}\n${JSON.stringify({
    candidate,
    issues: critic.issues.slice(0, 4),
    ...(req.targetWords ? { lengthPlan: lengthPlan(req, candidate) } : {}),
    keep: critic.keep,
    ...(req.targetWords && (lengthPlan(req, candidate)?.wordsToRemove ?? 0) > 0 ? {
      priorityEdit: `Compress the candidate to ${lengthPlan(req, candidate)?.draftingAim} Persian words. Remove ${lengthPlan(req, candidate)?.wordsToRemove} words of repetition or excess explanation across the document. This overrides surgical-only preservation of phrasing. Retain unique facts, conditions and warnings; return the complete shortened article.`,
    } : {}),
    ...(lintViolations.length ? { lintViolations: lintViolations.slice(0, 8) } : {}),
    editorialConstraints: {
      invertedPyramid: true,
      preserveAnchors: true,
      naturalSentenceRepair: true,
    },
  })}`;
}

export function buildAnalysisSystemPrompt(req: HumanizeRequest): string {
  return [
    coreSkill,
    analysisSkill,
    contentTypeSkills[req.contentType],
    qualitySkills[req.quality],
    req.quality === "precise" || req.quality === "strict"
      ? "شکاف های چه کسی، چگونه و چرا و ادعاهای نیازمند منبع را جدا و صریح بررسی کن."
      : "فقط شکاف ها و ادعاهای قابل توضیح را گزارش کن.",
  ].join("\n\n");
}

export function buildAnalysisUserPrompt(req: HumanizeRequest, rewritten: string): string {
  return JSON.stringify({
    original: req.text,
    rewritten,
    perspective: req.perspective ?? "third_person",
    trustedContext: {
      ...(req.articleGoal?.trim() ? { articleGoal: req.articleGoal.trim() } : {}),
      ...(req.audience?.trim() ? { audience: req.audience.trim() } : {}),
      ...(req.sources?.trim() ? { suppliedSources: req.sources.trim() } : {}),
      ...(req.authorProfile?.trim() ? { authorProfile: req.authorProfile.trim() } : {}),
      ...(req.notes?.trim() ? { authorNotes: req.notes.trim() } : {}),
    },
  });
}
