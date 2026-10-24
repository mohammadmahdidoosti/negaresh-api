import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "arrow-go"
  | "chevron-down"
  | "plus"
  | "copy"
  | "check"
  | "download"
  | "spinner";

type IconProps = {
  name: IconName;
} & SVGProps<SVGSVGElement>;

/** Compact stroke set. `arrow-go` points left — forward in RTL. */
export function Icon({ name, className = "size-4", ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={name === "spinner" ? `icon-spinner ${className}` : className}
      aria-hidden="true"
      {...props}
    >
      {ICONS[name]}
    </svg>
  );
}

const ICONS: Record<IconName, ReactNode> = {
  "arrow-go": (
    <>
      <path d="M15 6 9 12l6 6" />
      <path d="M9 12h11" />
    </>
  ),
  "chevron-down": <path d="M6 9l6 6 6-6" />,
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="10.5" height="10.5" rx="2" />
      <path d="M6.5 15V6.8A1.8 1.8 0 0 1 8.3 5h8.2" />
    </>
  ),
  check: <path d="M5 12.5 9.5 17 19 7.5" />,
  download: (
    <>
      <path d="M12 4v12" />
      <path d="M7.5 12 12 16.5 16.5 12" />
      <path d="M5 20h14" />
    </>
  ),
  spinner: (
    <>
      <circle cx="12" cy="12" r="8.25" opacity="0.22" />
      <path d="M20.25 12A8.25 8.25 0 0 0 12 3.75" />
    </>
  ),
};

/** Empty output mark — page with RTL-ragged lines (aligned to the right). */
export function EmptyDocument({ className = "size-16" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M70 18H30a6 6 0 0 0-6 6v48a6 6 0 0 0 6 6h40a6 6 0 0 0 6-6V24a6 6 0 0 0-6-6z" />
      <path d="M64 36H36M64 48H40M64 60H48" />
    </svg>
  );
}
