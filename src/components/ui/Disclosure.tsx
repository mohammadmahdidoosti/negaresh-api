"use client";

import { useId, useState, type ReactNode } from "react";

import { Icon } from "./Icon";

type DisclosureProps = {
  title: string;
  hint?: string;
  children: ReactNode;
};

export function Disclosure({ title, hint, children }: DisclosureProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div className="paper-panel overflow-hidden">
      <button
        type="button"
        className="details-toggle w-full"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 text-right">
          {title}{" "}
          {hint ? <span className="font-normal text-smoke">{hint}</span> : null}
        </span>
        <span className={`toggle-sign ${open ? "is-open" : ""}`}>
          <Icon name="chevron-down" className="size-4" />
        </span>
      </button>
      <div
        id={panelId}
        role="region"
        {...(!open ? { inert: true } : {})}
        className={`details-panel ${open ? "is-open" : ""}`}
      >
        <div className="details-panel-inner">{children}</div>
      </div>
    </div>
  );
}
