"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { Icon } from "./Icon";

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
};

type SelectProps<T extends string> = {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  "aria-label"?: string;
  labelledBy?: string;
  id?: string;
};

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  id,
  labelledBy,
  "aria-label": ariaLabel,
}: SelectProps<T>) {
  const reactId = useId();
  const listId = `${reactId}-list`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number>(0);

  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [open, setOpen] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  const selected = options[selectedIndex] ?? options[0];

  const openMenu = useCallback(() => {
    if (disabled) return;
    window.clearTimeout(closeTimer.current);
    setActiveIndex(selectedIndex);
    setRendered(true);
    setOpen(true);
  }, [disabled, selectedIndex]);

  const closeMenu = useCallback(() => {
    setOpen(false);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setRendered(false), 160);
  }, []);

  const selectIndex = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option) return;
      onChange(option.value);
      closeMenu();
      buttonRef.current?.focus();
    },
    [closeMenu, onChange, options],
  );

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => {
    if (!rendered) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closeMenu();
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [closeMenu, rendered]);

  function moveActive(delta: number) {
    setActiveIndex((current) => {
      const next = (current + delta + options.length) % options.length;
      document.getElementById(`${listId}-opt-${next}`)?.scrollIntoView({ block: "nearest" });
      return next;
    });
  }

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) openMenu();
        else moveActive(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) openMenu();
        else moveActive(-1);
        break;
      case "Home":
        if (open) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case "End":
        if (open) {
          event.preventDefault();
          setActiveIndex(options.length - 1);
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (!open) openMenu();
        else selectIndex(activeIndex);
        break;
      case "Tab":
        if (open) closeMenu();
        break;
      default:
        break;
    }
  }

  const activeId = rendered ? `${listId}-opt-${activeIndex}` : undefined;

  return (
    <div ref={rootRef} className="select-root">
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        id={id ?? `${reactId}-btn`}
        disabled={disabled}
        className="select-trigger"
        aria-labelledby={labelledBy ? `${labelledBy} ${id ?? `${reactId}-btn`}` : undefined}
        aria-label={labelledBy ? undefined : ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? activeId : undefined}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onButtonKeyDown}
      >
        <span className="min-w-0 truncate">{selected?.label}</span>
        <Icon name="chevron-down" className={`size-4 shrink-0 text-smoke transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {rendered && (
        <ul
          id={listId}
          role="listbox"
          aria-labelledby={labelledBy}
          aria-label={labelledBy ? undefined : ariaLabel}
          className={`select-menu ${open ? "is-open" : ""}`}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <li
                key={option.value}
                id={`${listId}-opt-${index}`}
                role="option"
                aria-selected={isSelected}
                className={`select-option ${isActive ? "is-active" : ""} ${isSelected ? "is-selected" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectIndex(index)}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {isSelected && <Icon name="check" className="size-4 shrink-0" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
