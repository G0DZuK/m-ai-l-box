import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { IconX } from '../components/Icons';

export type ToastKind = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastState {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastState | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, message, kind }]);
      window.setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 5000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end"
        role="status"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto flex max-w-sm items-start gap-3 rounded-lg px-4 py-3 text-sm shadow-lg ring-1',
              'motion-safe:animate-[fadeIn_150ms_ease-out]',
              t.kind === 'error' && 'bg-red-700 text-white ring-red-800',
              t.kind === 'success' && 'bg-emerald-700 text-white ring-emerald-800',
              t.kind === 'info' && 'bg-slate-900 text-white ring-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:ring-slate-300',
            )}
          >
            <span className="flex-1 break-words">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="-mr-1 rounded p-0.5 opacity-80 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              aria-label="Dismiss notification"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
