/**
 * In-memory store of generated category content (latest 5 results per category).
 * Lives in this server process only: export results before a restart (panel → «دانلود همه»).
 */
import type { ContentResult } from './pipeline';

const globalStore = globalThis as typeof globalThis & { __negareshContent?: Map<string, ContentResult[]> };
const results: Map<string, ContentResult[]> = (globalStore.__negareshContent ??= new Map());

export function saveResult(result: ContentResult): void {
  const list = results.get(result.category.id) ?? [];
  list.unshift(result);
  results.set(result.category.id, list.slice(0, 5));
}

export function listResults(): ContentResult[] {
  return [...results.values()].flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getResult(resultId: string): ContentResult | undefined {
  for (const list of results.values()) {
    const hit = list.find(r => r.resultId === resultId);
    if (hit) return hit;
  }
  return undefined;
}

/** Re-import previously exported results (e.g. after a restart). */
export function importResults(items: ContentResult[]): number {
  let n = 0;
  for (const r of items) {
    if (!r?.resultId || !r.category?.id || getResult(r.resultId)) continue;
    saveResult(r);
    n += 1;
  }
  return n;
}
