"use client";

import {
  CONTENT_TYPES,
  QUALITY_LEVELS,
  type ContentType,
  type QualityLevel,
} from "@/lib/types";
import { QualitySlider } from "@/components/ui/QualitySlider";
import { Select } from "@/components/ui/Select";

const CONTENT_LABELS: Record<ContentType, string> = {
  general: "عمومی — مقاله و توضیح",
  howto: "آموزشی — قدم به قدم",
  commercial: "تجاری — محصول و مقایسه",
  news: "خبر و رویداد",
  ymyl_health: "حساس — سلامت و ایمنی",
  ymyl_money: "حساس — مالی و بیمه",
  ymyl_legal_civic: "حساس — حقوقی و مدنی",
  opinion: "دیدگاه و نظر",
};

const CONTENT_OPTIONS = CONTENT_TYPES.map((value) => ({
  value,
  label: CONTENT_LABELS[value],
}));

export const QUALITY_LABELS: Record<QualityLevel, string> = {
  simple: "ساده",
  readable: "خواندنی",
  precise: "دقیق",
  strict: "سخت‌گیر",
};

const QUALITY_HELP: Record<QualityLevel, string> = {
  simple: "نسخه سریع و پیش نویس گونه",
  readable: "تعادل وضوح و ریتم طبیعی",
  precise: "ویرایش دقیق تر و منتقد برای متن بلند",
  strict: "بازبینی سخت گیرانه و احتیاط بیشتر",
};

interface EditorialControlsProps {
  contentType: ContentType;
  quality: QualityLevel;
  onContentTypeChange: (value: ContentType) => void;
  onQualityChange: (value: QualityLevel) => void;
  disabled?: boolean;
}

export default function EditorialControls({
  contentType,
  quality,
  onContentTypeChange,
  onQualityChange,
  disabled,
}: EditorialControlsProps) {
  return (
    <div className="mt-5 grid gap-5 border-t border-ash pt-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="field-label">
        <span id="content-type-label">نوع محتوا</span>
        <Select
          value={contentType}
          options={CONTENT_OPTIONS}
          onChange={onContentTypeChange}
          disabled={disabled}
          labelledBy="content-type-label"
        />
      </div>

      <div className="field-label">
        <div className="flex items-center justify-between gap-3">
          <span>کیفیت</span>
          <span className="quality-badge">{QUALITY_LABELS[quality]}</span>
        </div>
        <QualitySlider
          levels={QUALITY_LEVELS}
          value={quality}
          labels={QUALITY_LABELS}
          onChange={onQualityChange}
          disabled={disabled}
          aria-label="سطح کیفیت"
          aria-valuetext={QUALITY_LABELS[quality]}
        />
        <p className="text-xs font-normal leading-6 text-smoke">{QUALITY_HELP[quality]}</p>
      </div>
    </div>
  );
}
