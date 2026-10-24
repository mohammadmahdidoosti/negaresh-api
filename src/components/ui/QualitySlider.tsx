"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

type QualitySliderProps<T extends string> = {
  levels: readonly T[];
  value: T;
  labels: Record<T, string>;
  onChange: (value: T) => void;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-valuetext"?: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function QualitySlider<T extends string>({
  levels,
  value,
  labels,
  onChange,
  disabled,
  "aria-label": ariaLabel,
  "aria-valuetext": ariaValueText,
}: QualitySliderProps<T>) {
  const max = levels.length - 1;
  const committed = Math.max(0, levels.indexOf(value));
  const [visual, setVisual] = useState(committed);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const railRef = useRef<HTMLSpanElement>(null);
  const sliderId = useId();

  useEffect(() => {
    if (!draggingRef.current) setVisual(committed);
  }, [committed]);

  const snapTo = useCallback(
    (raw: number) => {
      const index = Math.round(clamp(raw, 0, max));
      setVisual(index);
      onChange(levels[index]);
    },
    [levels, max, onChange],
  );

  const valueFromClientX = useCallback(
    (clientX: number) => {
      const rail = railRef.current;
      if (!rail) return committed;
      const rect = rail.getBoundingClientRect();
      if (rect.width <= 0) return committed;
      const rtl = getComputedStyle(rail).direction === "rtl";
      const ratio = rtl ? (rect.right - clientX) / rect.width : (clientX - rect.left) / rect.width;
      return clamp(ratio, 0, 1) * max;
    },
    [committed, max],
  );

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    setDragging(true);
    setVisual(valueFromClientX(event.clientX));
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    setVisual(valueFromClientX(event.clientX));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    draggingRef.current = false;
    snapTo(valueFromClientX(event.clientX));
    setDragging(false);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const forward = rtl ? "ArrowLeft" : "ArrowRight";
    const back = rtl ? "ArrowRight" : "ArrowLeft";
    if (event.key === forward || event.key === "ArrowUp") {
      event.preventDefault();
      snapTo(committed + 1);
    } else if (event.key === back || event.key === "ArrowDown") {
      event.preventDefault();
      snapTo(committed - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      snapTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      snapTo(max);
    }
  }

  const progress = `${(visual / max) * 100}%`;
  const nearest = Math.round(clamp(visual, 0, max));

  return (
    <div
      className={`quality-slider${dragging ? " is-dragging" : ""}`}
      style={{ "--quality-progress": progress, "--quality-max": max } as CSSProperties}
    >
      <div
        className="quality-control"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        id={sliderId}
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={nearest}
        aria-valuetext={ariaValueText ?? labels[levels[nearest]]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <span ref={railRef} className="quality-rail">
          <span className="quality-fill" />
          {levels.map((level, index) => (
            <span
              key={level}
              className={`quality-notch${index === nearest ? " is-active" : ""}`}
              style={{ "--i": index } as CSSProperties}
            />
          ))}
          <span className="quality-thumb" />
        </span>
      </div>

      <div className="quality-stops">
        {levels.map((level, index) => (
          <button
            key={level}
            type="button"
            disabled={disabled}
            className={`quality-stop${index === nearest ? " is-active" : ""}`}
            style={{ "--i": index } as CSSProperties}
            onClick={() => snapTo(index)}
          >
            {labels[level]}
          </button>
        ))}
      </div>
    </div>
  );
}
