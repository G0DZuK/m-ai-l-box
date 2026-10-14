import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx';
import { IconX } from './Icons';
import { iconBtn } from './ui';

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, object, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  initialFocusRef?: RefObject<HTMLElement>;
  /** Prevent closing by Escape/backdrop (e.g. while a request is running). */
  dismissible?: boolean;
}

/** Accessible modal dialog: focus trap, Escape to close, focus restore, scroll lock. */
export function Modal({ open, onClose, title, description, children, footer, size = 'md', initialFocusRef, dismissible = true }: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target =
        initialFocusRef?.current ??
        panel.querySelector<HTMLElement>('[data-autofocus]') ??
        panel.querySelector<HTMLElement>(FOCUSABLE) ??
        panel;
      target.focus();
    }, 0);
    // Escape closes only the topmost dialog, wherever focus currently is. Capture phase so
    // page-level shortcut handlers never see the key.
    const onDocKey = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      const panels = document.querySelectorAll('[data-modal-panel]');
      if (panels[panels.length - 1] !== panel) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (dismissibleRef.current) onCloseRef.current();
      } else if (e.key === 'Tab' && !panel.contains(document.activeElement)) {
        // Focus escaped the dialog (e.g. clicked the backdrop): bring it back.
        e.preventDefault();
        (panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus();
      }
    };
    document.addEventListener('keydown', onDocKey, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onDocKey, true);
      // Only unlock scrolling when no other modal remains open.
      if (!document.querySelector('[data-modal-panel]')) body.style.overflow = prevOverflow;
      else body.style.overflow = 'hidden';
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (items.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const widths: Record<NonNullable<ModalProps['size']>, string> = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-6xl',
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" onKeyDown={onKeyDown}>
      <div
        className="absolute inset-0 bg-slate-950/50 motion-safe:animate-[fadeIn_120ms_ease-out]"
        aria-hidden="true"
        onMouseDown={() => {
          if (dismissibleRef.current) onCloseRef.current();
        }}
      />
      <div
        ref={panelRef}
        data-modal-panel=""
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cx(
          'relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-2xl outline-none ring-1 ring-slate-900/10 sm:rounded-2xl dark:bg-slate-900 dark:ring-slate-700',
          'motion-safe:animate-[popIn_140ms_ease-out]',
          widths[size],
        )}
      >
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold text-slate-900 dark:text-white">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <button type="button" className={iconBtn} onClick={onClose} aria-label="Close dialog">
              <IconX />
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-slate-800 dark:text-slate-200">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** True while any modal dialog is open (used to suspend global shortcuts). */
export function isModalOpen(): boolean {
  return !!document.querySelector('[data-modal-panel]');
}
