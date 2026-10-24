import type { EeatAnalysis, EeatGapType } from "@/lib/types";

const GAP_LABELS: Record<EeatGapType, string> = {
  who: "چه کسی",
  how: "چگونه",
  why: "چرا",
  experience: "تجربه",
};

export default function EeatPanel({ analysis }: { analysis: EeatAnalysis }) {
  const empty = analysis.gaps.length === 0
    && analysis.unsourcedClaims.length === 0
    && analysis.placeholders.length === 0;

  return (
    <section aria-label="پرچم های E-E-A-T" className="paper-panel p-8 sm:p-10">
      <div className="mb-4 flex items-center gap-3">
        <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full border border-ash bg-periwinkle/60 font-medium text-off-black">E</span>
        <div>
          <h2 className="text-sm font-medium text-off-black">اعتماد و پشتوانه</h2>
          <p className="mt-0.5 text-[11px] text-smoke">بررسی E-E-A-T خروجی</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs leading-6">
        {empty && <span className="text-smoke">شکاف مشخصی پیدا نشد؛ بررسی نهایی همچنان با شماست.</span>}
        {analysis.gaps.map((gap, index) => (
          <span key={`${gap.type}-${index}`} title={gap.detail} className="status-chip status-chip-ready">
            {GAP_LABELS[gap.type]}: {gap.title}
          </span>
        ))}
        {analysis.unsourcedClaims.map((claim, index) => (
          <span key={`claim-${index}`} title={claim.reason} className="status-chip status-chip-warn">
            نیاز به منبع: «{claim.quote}»
          </span>
        ))}
        {analysis.placeholders.map((placeholder, index) => (
          <span key={`${placeholder.marker}-${index}`} title={placeholder.guidance} className="status-chip !border-ash !bg-periwinkle/50 !text-off-black">
            {placeholder.marker} · {placeholder.label}
          </span>
        ))}
      </div>
    </section>
  );
}
