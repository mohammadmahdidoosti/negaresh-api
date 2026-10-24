/** Preflight signal for the real context required by high-quality articles. */

import { Icon } from "@/components/ui/Icon";

interface ContextReadinessProps {
  articleGoal: string;
  audience: string;
  sources: string;
  notes: string;
  authorProfile: string;
}

export default function ContextReadiness({
  articleGoal,
  audience,
  sources,
  notes,
  authorProfile,
}: ContextReadinessProps) {
  const intentReady = Boolean(articleGoal.trim() && audience.trim());
  const evidenceReady = Boolean(sources.trim());
  const experienceReady = Boolean(notes.trim() || authorProfile.trim());
  const complete = intentReady && evidenceReady && experienceReady;

  return (
    <section
      aria-label="آمادگی زمینه مقاله"
      className={`rounded-[24px] border px-4 py-3 text-xs leading-6 ${complete
        ? "border-ash bg-mint/30"
        : "border-ash bg-parchment"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-off-black">آمادگی ورودی</h2>
        <span className={`status-chip ${intentReady ? "status-chip-ready" : ""}`}>
          {intentReady ? <Icon name="check" className="size-3.5" /> : <span className="size-1.5 rounded-full bg-ash" aria-hidden="true" />}
          {intentReady ? "هدف و مخاطب" : "هدف یا مخاطب ناقص"}
        </span>
        <span className={`status-chip ${evidenceReady ? "status-chip-ready" : ""}`}>
          {evidenceReady ? <Icon name="check" className="size-3.5" /> : <span className="size-1.5 rounded-full bg-ash" aria-hidden="true" />}
          {evidenceReady ? "منبع واقعی" : "منبع واقعی وارد نشده"}
        </span>
        <span className={`status-chip ${experienceReady ? "status-chip-ready" : ""}`}>
          {experienceReady ? <Icon name="check" className="size-3.5" /> : <span className="size-1.5 rounded-full bg-ash" aria-hidden="true" />}
          {experienceReady ? "تجربه یا هویت نویسنده" : "تجربه نویسنده وارد نشده"}
        </span>
      </div>
      {!complete && (
        <p className="mt-2 text-smoke">
          این موارد اجباری نیستند؛ در نبود داده واقعی، سیستم جای گذار می گذارد و جزئیات تازه نمی سازد.
        </p>
      )}
    </section>
  );
}
