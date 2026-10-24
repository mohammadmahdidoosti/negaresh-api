/**
 * localStorage-backed history of the last rewrites (client-side only).
 */

import type { HistoryEntry } from "./types";

const STORAGE_KEY = "persian-humanizer:history";
const MAX_HISTORY = 5;

export function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is HistoryEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as HistoryEntry).id === "string" &&
        typeof (entry as HistoryEntry).original === "string" &&
        typeof (entry as HistoryEntry).result === "string",
    );
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(entries.slice(0, MAX_HISTORY)),
    );
  } catch {
    // Storage full or unavailable — history is best-effort, ignore.
  }
}

const AUTHOR_PROFILE_KEY = "persian-humanizer:author-profile";

/** Author profile persists across sessions for the always-on E-E-A-T context. */
export function loadAuthorProfile(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(AUTHOR_PROFILE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveAuthorProfile(profile: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTHOR_PROFILE_KEY, profile);
  } catch {
    // Storage unavailable — best-effort, ignore.
  }
}

export function clearHistory(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
