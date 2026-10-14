import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { focusRing } from './ui';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  hint?: string;
}

interface MenuProps {
  /** Contents of the trigger button. */
  trigger: ReactNode;
  triggerLabel: string;
  triggerClassName: string;
  items: Array<MenuItem | 'separator'>;
  align?: 'left' | 'right';
  header?: ReactNode;
}

/** Accessible dropdown menu (button + role="menu"), keyboard navigable. */
export function Menu({ trigger, triggerLabel, triggerClassName, items, align = 'right', header }: MenuProps) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    const t = window.setTimeout(() => listRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.clearTimeout(t);
    };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    const els = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
    const idx = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      els[(idx + 1) % els.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      els[(idx - 1 + els.length) % els.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      els[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      els[els.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={triggerLabel}
        title={triggerLabel}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={listRef}
          id={menuId}
          role="menu"
          aria-label={triggerLabel}
          className={cx(
            'absolute z-40 mt-1 min-w-[14rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {header && <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-700">{header}</div>}
          {items.map((item, i) =>
            item === 'separator' ? (
              <div key={`sep-${i}`} role="separator" className="my-1 border-t border-slate-200 dark:border-slate-700" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  buttonRef.current?.focus();
                  item.onSelect();
                }}
                className={cx(
                  'flex w-full items-center gap-3 px-3 py-2 text-left text-sm disabled:opacity-50',
                  focusRing,
                  'focus-visible:ring-inset focus-visible:ring-offset-0',
                  item.danger
                    ? 'text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/50'
                    : 'text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800',
                )}
              >
                {item.icon && <span className="shrink-0 opacity-80">{item.icon}</span>}
                <span className="flex-1">
                  {item.label}
                  {item.hint && <span className="block text-xs text-slate-500 dark:text-slate-400">{item.hint}</span>}
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
