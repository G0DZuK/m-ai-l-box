// Shared Tailwind class strings for consistent controls in both themes.

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-indigo-400 dark:focus-visible:ring-offset-slate-900';

const btnBase = `inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

export const btnPrimary = `${btnBase} bg-indigo-600 px-4 py-2 text-white shadow-sm hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400 dark:text-slate-950`;
export const btnSecondary = `${btnBase} border border-slate-300 bg-white px-4 py-2 text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700`;
export const btnGhost = `${btnBase} px-3 py-2 text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800`;
export const btnDanger = `${btnBase} bg-red-600 px-4 py-2 text-white shadow-sm hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400 dark:text-slate-950`;
export const btnSmall = `${btnBase} border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700`;
export const iconBtn = `inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white ${focusRing}`;
export const iconBtnSm = `inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white ${focusRing}`;

export const input = `block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus:border-indigo-400`;
export const select = `${input} pr-8`;
export const label = 'mb-1 block text-sm font-medium text-slate-800 dark:text-slate-200';
export const hint = 'mt-1 text-xs text-slate-600 dark:text-slate-400';
export const checkbox =
  'h-4 w-4 rounded border-slate-400 text-indigo-600 focus:ring-2 focus:ring-indigo-500 dark:border-slate-500 dark:bg-slate-800';

export const card = 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900';
export const muted = 'text-slate-600 dark:text-slate-400';
export const linkText = `rounded text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300 ${focusRing}`;
