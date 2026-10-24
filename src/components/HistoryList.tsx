/** History of the last 5 rewrites, persisted in localStorage. */

"use client";

import type { ContentType, HistoryEntry, QualityLevel, Voice } from "@/lib/types";

const VOICE_LABELS: Record<Voice, string> = {
  formal: "اداری", standard: "استاندارد", casual: "خودمانی", roughcut: "دم‌دستی",
};

const TYPE_LABELS: Record<ContentType, string> = {
  general: "عمومی", howto: "آموزشی", commercial: "تجاری", news: "خبر",
  ymyl_health: "سلامت", ymyl_money: "مالی", ymyl_legal_civic: "حقوقی/مدنی",
  opinion: "دیدگاه",
};
const QUALITY_LABELS: Record<QualityLevel, string> = {
  simple: "ساده", readable: "خواندنی", precise: "دقیق", strict: "سخت‌گیر",
};

interface HistoryListProps {
  entries: HistoryEntry[];
  onRestore: (entry: HistoryEntry) => void;
  onClear: () => void;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });
}

export default function HistoryList({ entries, onRestore, onClear }: HistoryListProps) {
  if (entries.length === 0) return null;

  return (
    <section className="paper-panel p-8 sm:p-10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <span className="section-kicker">تاریخچه محلی</span>
          <h2 className="text-base font-medium text-off-black">بازنویسی‌های اخیر</h2>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="outline-button px-3 py-1.5 text-xs text-smoke hover:text-error-ink"
        >
          پاک کردن تاریخچه
        </button>
      </div>
      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              onClick={() => onRestore(entry)}
              className="history-entry"
            >
              <div className="mb-1 flex items-center gap-2 text-[11px] text-smoke">
                <span>{entry.voice ? VOICE_LABELS[entry.voice] : VOICE_LABELS.standard}</span>
                <span aria-hidden="true">·</span>
                <span>{entry.contentType ? TYPE_LABELS[entry.contentType] : TYPE_LABELS.general}</span>
                <span aria-hidden="true">·</span>
                <span>{entry.qualityLevel ? QUALITY_LABELS[entry.qualityLevel] : QUALITY_LABELS.readable}</span>
                <span aria-hidden="true">·</span>
                <span>{formatTime(entry.createdAt)}</span>
              </div>
              <p className="truncate text-sm text-off-black">{entry.result}</p>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
