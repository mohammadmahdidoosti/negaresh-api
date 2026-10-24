/** Stylometric before/after panel with target bands. */

"use client";

import type { MetricsPair, StyleMetrics } from "@/lib/types";

const fmtInt = (n: number) => n.toLocaleString("fa-IR");
const fmt1 = (n: number) => n.toLocaleString("fa-IR", { maximumFractionDigits: 1 });
const fmtPct = (r: number) => `${Math.round(r * 100).toLocaleString("fa-IR")}٪`;

interface MetricRow {
  label: string;
  value: (m: StyleMetrics) => string;
  target: string;
  /** Values above 0 need review (clichés). */
  danger?: boolean;
}

const ROWS: MetricRow[] = [
  { label: "تعداد جمله‌ها", value: (m) => fmtInt(m.sentenceCount), target: "—" },
  { label: "میانگین طول جمله (واژه)", value: (m) => fmt1(m.meanSentenceWords), target: "متنوع" },
  {
    label: "انحراف معیار طول جمله (بورستی)",
    value: (m) => fmt1(m.stdDevSentenceWords),
    target: "تنوع طبیعی؛ وابسته به متن",
  },
  {
    label: "سهم جملات کوتاه (۴–۹ واژه)",
    value: (m) => fmtPct(m.shortSentenceShare),
    target: "≥ ۲۰–۳۰٪",
  },
  { label: "جملات بلند (۲۵+ واژه)", value: (m) => fmtPct(m.long25Share), target: "محدود" },
  {
    label: "جملات خیلی بلند (۴۱+ واژه)",
    value: (m) => fmtPct(m.long41Share),
    target: "≈ ۰٪",
  },
  { label: "نسبت واژه‌های نقشی", value: (m) => fmtPct(m.functionWordRatio), target: "—" },
  { label: "تنوع واژگانی (TTR)", value: (m) => fmt1(m.typeTokenRatio), target: "—" },
  {
    label: "کلیشه‌های هوش مصنوعی",
    value: (m) => fmtInt(m.clicheHits),
    target: "۰",
    danger: true,
  },
  {
    label: "نیم فاصله در هر ۱۰۰۰ نویسه",
    value: (m) => fmt1(m.zwnjDensity),
    target: "کم؛ فاصله معمولی مجاز است",
  },
  { label: "تعداد واژه‌ها", value: (m) => fmtInt(m.wordCount), target: "—" },
];

export default function MetricsPanel({ metrics }: { metrics: MetricsPair }) {
  const { before, after } = metrics;
  const delta =
    before && before.charCount > 0
      ? Math.round(((after.charCount - before.charCount) / before.charCount) * 100)
      : null;

  return (
    <section className="paper-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ash px-5 py-5 sm:px-6">
        <div>
          <span className="section-kicker">گزارش سبک</span>
          <h2 className="panel-heading">پیش و پس از بازنویسی</h2>
        </div>
        <span className="status-chip">۱۱ شاخص قابل‌اندازه‌گیری</span>
      </div>
      <div className="overflow-x-auto px-5 pb-5 sm:px-6">
        <table className="w-full min-w-[480px] text-right text-sm">
          <thead>
            <tr className="border-b border-ash text-xs text-smoke">
              <th className="py-4 font-medium">شاخص</th>
              <th className="py-4 font-medium">متن اصلی</th>
              <th className="py-4 font-medium">خروجی</th>
              <th className="py-4 font-medium">هدف</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ash/60">
            {ROWS.map((row) => {
              const afterValue = row.value(after);
              const bad = row.danger && !afterValue.startsWith("۰");
              return (
                <tr key={row.label}>
                  <td className="py-3 text-off-black">{row.label}</td>
                  <td className="py-3 text-smoke">{before ? row.value(before) : "—"}</td>
                  <td
                    className={`py-3 font-medium ${
                      bad ? "text-error-ink" : "text-graphite"
                    }`}
                  >
                    {afterValue}
                  </td>
                  <td className="py-3 text-xs text-smoke">{row.target}</td>
                </tr>
              );
            })}
            <tr>
              <td className="py-3 text-off-black">طول (کاراکتر)</td>
              <td className="py-3 text-smoke">{before ? fmtInt(before.charCount) : "—"}</td>
              <td className="py-3 font-medium text-graphite">{fmtInt(after.charCount)}</td>
              <td className="py-3 text-xs text-smoke">
                {delta === null ? "—" : `اختلاف: ${delta > 0 ? "+" : "−"}${fmtInt(Math.abs(delta))}٪`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
