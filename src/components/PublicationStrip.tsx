import type { PublicationBlocker, PublicationReadiness } from "@/lib/types";

const BLOCKER_LABELS: Record<PublicationBlocker, string> = {
  analysis_unavailable: "تحلیل اعتماد کامل نشد",
  quality_review: "بازبینی تحریریه لازم است",
  eeat_gap: "شکاف هویت، روش یا تجربه",
  unsourced_claim: "ادعای نیازمند منبع",
  unresolved_placeholder: "جای گذار حل نشده",
};

export default function PublicationStrip({ publication }: { publication: PublicationReadiness }) {
  const ready = publication.status === "ready-for-human-review";
  return (
    <section
      aria-label="آمادگی انتشار"
      className={`rounded-[24px] border px-5 py-4 text-xs ${ready
        ? "border-ash bg-mint/30"
        : "border-ash bg-coral/20"}`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span aria-hidden="true" className={`size-2.5 rounded-full ${ready ? "bg-off-black" : "bg-crimson"}`} />
        <h2 className="text-sm font-medium text-off-black">آمادگی انتشار</h2>
        <strong className={ready ? "text-graphite" : "text-error-ink"}>
          {ready ? "آماده بازبینی نهایی انسان" : "هنوز آماده انتشار نیست"}
        </strong>
        {publication.blockers.map((blocker) => (
          <span key={blocker} className="status-chip">{BLOCKER_LABELS[blocker]}</span>
        ))}
      </div>
    </section>
  );
}
