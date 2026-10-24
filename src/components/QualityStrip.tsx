import type { ContentType, QualityLevel, QualityReport, Voice } from "@/lib/types";

const VOICE_LABELS: Record<Voice, string> = {
  formal: "اداری", standard: "استاندارد", casual: "خودمانی", roughcut: "دم‌دستی",
};

const CONTENT_LABELS: Record<ContentType, string> = {
  general: "عمومی", howto: "آموزشی", commercial: "تجاری", news: "خبر",
  ymyl_health: "سلامت", ymyl_money: "مالی", ymyl_legal_civic: "حقوقی/مدنی",
  opinion: "دیدگاه",
};
const QUALITY_LABELS: Record<QualityLevel, string> = {
  simple: "ساده", readable: "خواندنی", precise: "دقیق", strict: "سخت‌گیر",
};

export default function QualityStrip({
  quality,
  edited = false,
}: {
  quality: QualityReport;
  edited?: boolean;
}) {
  const score = quality.final;
  const pass = score.verdict === "pass";
  const codes = [...new Set(score.issues.map((issue) => issue.code))];
  const editorial = score.editorialSignals;

  return (
    <section
      aria-label="کیفیت"
      role="status"
      className={`flex flex-wrap items-center gap-2 rounded-[24px] border px-5 py-4 text-xs ${
        pass && !quality.humanReviewRequired && !edited
          ? "border-ash bg-mint/30 text-off-black"
          : "border-ash bg-parchment text-off-black"
      }`}
    >
      <h2 className="text-sm font-medium">کیفیت</h2>
      <span className="status-chip !bg-periwinkle/50 !text-off-black">{VOICE_LABELS[quality.voice]} · {CONTENT_LABELS[quality.contentType]} · {QUALITY_LABELS[quality.qualityLevel]}</span>
      <span className="status-chip">بررسی محلی: {pass ? "قبول" : "نیاز به اصلاح"}</span>
      <span className="status-chip">منتقد: {quality.criticRan
        ? quality.criticVerdict === "unavailable" ? "ناموفق" : "اجرا شد"
        : "اجرا نشد"}</span>
      <span className="status-chip">{quality.refineRan ? "یک بار اصلاح شد" : "بدون اصلاح مجدد"}</span>
      <span className="status-chip">جمله کوتاه: {Math.round(score.metrics.shortSentenceShare * 100).toLocaleString("fa-IR")}٪</span>
      <span className="status-chip">کلیشه: {score.metrics.clicheHits.toLocaleString("fa-IR")}</span>
      {editorial && (
        <>
          <span className="status-chip">پاسخ اول: {editorial.answerFirst === "direct"
            ? "مستقیم"
            : editorial.answerFirst === "delayed" ? "با تأخیر" : "متن کوتاه"}</span>
          <span className="status-chip">عمق مستند: {editorial.requiredDepthPoints > 0
            ? `${Math.min(editorial.groundedDepthPoints, editorial.requiredDepthPoints).toLocaleString("fa-IR")}/${editorial.requiredDepthPoints.toLocaleString("fa-IR")}`
            : "برای متن بلند سنجیده می شود"}</span>
          <span className="status-chip">نسبت مبهم: {editorial.vagueAttributionHits.toLocaleString("fa-IR")}</span>
        </>
      )}
      {codes.map((code) => <code key={code} dir="ltr" className="rounded-md bg-coral/20 px-2 py-1 text-error-ink">{code}</code>)}
      {(quality.humanReviewRequired || edited) && <strong className="text-error-ink">بازبینی انسانی لازم است</strong>}
      {edited && <span className="text-smoke">این سنجش مربوط به قبل از ویرایش شماست.</span>}
    </section>
  );
}
