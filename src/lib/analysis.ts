/** Strict extraction and validation for structured critic and E-E-A-T calls. */
import type {
  CriticResult,
  EeatAnalysis,
  EeatGap,
  EeatGapType,
  EeatPlaceholder,
  UnsourcedClaim,
} from "./types";
import { CRITIC_CODES } from "./types";

const GAP_TYPES: EeatGapType[] = ["who", "how", "why", "experience"];
const ALLOWED_MARKERS = ["[[مثال واقعی]]", "[[تجربه نویسنده]]", "[[نیاز به منبع]]"];

export function extractJson(raw: string): unknown {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in LLM response");
  }
  return JSON.parse(text.slice(start, end + 1));
}

function asString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function asStringArray(value: unknown, maxLengthPerItem: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLengthPerItem)).filter(Boolean);
}

export function validateCriticResult(value: unknown): CriticResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid critic object");
  const obj = value as Record<string, unknown>;
  if ((obj.verdict !== "pass" && obj.verdict !== "refine") || !Array.isArray(obj.issues) || !Array.isArray(obj.keep)) {
    throw new Error("Invalid critic schema");
  }
  const issues = obj.issues.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Invalid critic issue");
    const issue = item as Record<string, unknown>;
    if (!CRITIC_CODES.includes(issue.code as typeof CRITIC_CODES[number]) || typeof issue.fix !== "string" || !issue.fix.trim()) {
      throw new Error("Invalid critic issue");
    }
    return { code: issue.code as typeof CRITIC_CODES[number], fix: issue.fix.trim().slice(0, 400) };
  }).slice(0, 4);
  if ((obj.verdict === "pass" && issues.length) || (obj.verdict === "refine" && !issues.length)) {
    throw new Error("Conflicting critic verdict");
  }
  if (obj.keep.some((item) => typeof item !== "string")) throw new Error("Invalid critic keep list");
  return { verdict: obj.verdict, issues, keep: asStringArray(obj.keep, 300).slice(0, 4) };
}

export function validateEeatAnalysis(value: unknown): EeatAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid E-E-A-T analysis object");
  }
  const obj = value as Record<string, unknown>;
  const gaps: EeatGap[] = Array.isArray(obj.gaps) ? obj.gaps.map((item): EeatGap | null => {
    if (!item || typeof item !== "object") return null;
    const gap = item as Record<string, unknown>;
    if (!GAP_TYPES.includes(gap.type as EeatGapType)) return null;
    const title = asString(gap.title, 120);
    const detail = asString(gap.detail, 500);
    if (!title && !detail) return null;
    return { type: gap.type as EeatGapType, title: title || String(gap.type), detail };
  }).filter((item): item is EeatGap => item !== null).slice(0, 6) : [];

  const unsourcedClaims: UnsourcedClaim[] = Array.isArray(obj.unsourcedClaims)
    ? obj.unsourcedClaims.map((item): UnsourcedClaim | null => {
      if (!item || typeof item !== "object") return null;
      const claim = item as Record<string, unknown>;
      const quote = asString(claim.quote, 300);
      const reason = asString(claim.reason, 400);
      return quote && reason ? { quote, reason } : null;
    }).filter((item): item is UnsourcedClaim => item !== null).slice(0, 6)
    : [];

  const placeholders: EeatPlaceholder[] = Array.isArray(obj.placeholders)
    ? obj.placeholders.map((item): EeatPlaceholder | null => {
      if (!item || typeof item !== "object") return null;
      const placeholder = item as Record<string, unknown>;
      const marker = asString(placeholder.marker, 60);
      const guidance = asString(placeholder.guidance, 400);
      if (!ALLOWED_MARKERS.includes(marker) || !guidance) return null;
      return { marker, label: asString(placeholder.label, 80) || marker, guidance };
    }).filter((item): item is EeatPlaceholder => item !== null).slice(0, 5)
    : [];

  return { gaps, unsourcedClaims, placeholders };
}
