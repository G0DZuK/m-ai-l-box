// Small presentational building blocks: banners, badges, spinners, empty states.
import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import { IconAlert, IconInfo } from './Icons';
import { btnSmall } from './ui';

export function ErrorBanner({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div
      role="alert"
      className={cx(
        'flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100',
        className,
      )}
    >
      <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button type="button" className={btnSmall} onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function InfoBanner({ children, tone = 'info', className }: { children: ReactNode; tone?: 'info' | 'warn'; className?: string }) {
  return (
    <div
      className={cx(
        'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm',
        tone === 'info' && 'border-indigo-200 bg-indigo-50 text-indigo-950 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100',
        tone === 'warn' && 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
        className,
      )}
    >
      {tone === 'warn' ? <IconAlert className="mt-0.5 h-4 w-4 shrink-0" /> : <IconInfo className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

type BadgeTone = 'neutral' | 'indigo' | 'green' | 'red' | 'amber' | 'purple';

export function Badge({ children, tone = 'neutral', className, title }: { children: ReactNode; tone?: BadgeTone; className?: string; title?: string }) {
  const tones: Record<BadgeTone, string> = {
    neutral: 'bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600',
    indigo: 'bg-indigo-50 text-indigo-800 ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-200 dark:ring-indigo-800',
    green: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800',
    red: 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-200 dark:ring-red-800',
    amber: 'bg-amber-50 text-amber-900 ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-700',
    purple: 'bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-200 dark:bg-fuchsia-950 dark:text-fuchsia-200 dark:ring-fuchsia-800',
  };
  return (
    <span
      title={title}
      className={cx('inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset', tones[tone], className)}
    >
      {children}
    </span>
  );
}

export function Spinner({ className = 'h-4 w-4', label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center">
      <svg className={cx('motion-safe:animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function EmptyState({ icon, title, children, className }: { icon?: ReactNode; title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cx('mx-auto flex max-w-md flex-col items-center px-6 py-12 text-center', className)}>
      {icon && <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{icon}</div>}
      <h3 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
      {children && <div className="mt-2 space-y-3 text-sm text-slate-600 dark:text-slate-400">{children}</div>}
    </div>
  );
}

export function UsageBar({ used, quota, label }: { used: number; quota: number; label?: string }) {
  const pct = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;
  const tone = pct >= 95 ? 'bg-red-600' : pct >= 80 ? 'bg-amber-500' : 'bg-indigo-600 dark:bg-indigo-400';
  return (
    <div>
      {label && <div className="mb-1 text-xs text-slate-600 dark:text-slate-400">{label}</div>}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={label ?? 'Storage used'}
      >
        <div className={cx('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{children}</h2>
      {action}
    </div>
  );
}
