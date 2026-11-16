// Shared Tailwind class strings for consistent controls in both themes.
// Restyled to match Gmail's visual language.

// Gmail blue: #1A73E8 | active pill: #D3E3FD | compose: #C2E7FF | text: #202124 | secondary text: #5F6368

export const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A73E8] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-[#8AB4F8] dark:focus-visible:ring-offset-[#1f1f1f]';

const btnBase = `inline-flex items-center justify-center gap-2 rounded-2xl text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;

// Gmail Compose button: light blue pill with dark text, shadow
export const btnPrimary = `${btnBase} bg-[#C2E7FF] px-5 py-2.5 text-[#001D35] shadow-md hover:bg-[#A8D7FF] hover:shadow-lg dark:bg-[#004A77] dark:text-[#C2E7FF] dark:hover:bg-[#005C8F]`;

// Secondary: outlined grey
export const btnSecondary = `${btnBase} border border-[#dadce0] bg-white px-4 py-2 text-[#444746] shadow-sm hover:bg-[#f6f8fc] dark:border-[#5f6368] dark:bg-[#2d2e30] dark:text-[#c4c7c5] dark:hover:bg-[#37393b]`;

export const btnGhost = `${btnBase} px-3 py-2 text-[#444746] hover:bg-[#f6f8fc] dark:text-[#c4c7c5] dark:hover:bg-[#2d2e30]`;
export const btnDanger = `${btnBase} bg-red-600 px-4 py-2 text-white shadow-sm hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400 dark:text-white`;
export const btnSmall = `${btnBase} border border-[#dadce0] bg-white px-2.5 py-1 text-xs text-[#444746] hover:bg-[#f6f8fc] dark:border-[#5f6368] dark:bg-[#2d2e30] dark:text-[#c4c7c5] dark:hover:bg-[#37393b]`;

// Icon buttons: Google-style circular hover
export const iconBtn = `inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#444746] transition-colors hover:bg-[#f6f8fc] hover:text-[#202124] disabled:cursor-not-allowed disabled:opacity-40 dark:text-[#c4c7c5] dark:hover:bg-[#37393b] dark:hover:text-white ${focusRing}`;
export const iconBtnSm = `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#5f6368] transition-colors hover:bg-[#e8eaed] hover:text-[#202124] disabled:opacity-40 dark:text-[#9aa0a6] dark:hover:bg-[#3c4043] dark:hover:text-white ${focusRing}`;

export const input = `block w-full rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-sm text-[#202124] placeholder:text-[#5f6368] shadow-sm focus:border-[#1A73E8] focus:outline-none focus:ring-2 focus:ring-[#1A73E8]/30 disabled:opacity-60 dark:border-[#5f6368] dark:bg-[#2d2e30] dark:text-[#e3e3e3] dark:placeholder:text-[#9aa0a6] dark:focus:border-[#8ab4f8]`;
export const select = `${input} pr-8`;
export const label = 'mb-1 block text-sm font-medium text-[#202124] dark:text-[#e3e3e3]';
export const hint = 'mt-1 text-xs text-[#5f6368] dark:text-[#9aa0a6]';
export const checkbox =
  'h-4 w-4 rounded border-[#dadce0] text-[#1A73E8] focus:ring-2 focus:ring-[#1A73E8] dark:border-[#5f6368] dark:bg-[#2d2e30]';

export const card = 'rounded-2xl border border-[#e0e0e0] bg-white p-4 shadow-sm dark:border-[#3c4043] dark:bg-[#2d2e30]';
export const muted = 'text-[#5f6368] dark:text-[#9aa0a6]';
export const linkText = `rounded text-[#1A73E8] underline-offset-2 hover:underline dark:text-[#8ab4f8] ${focusRing}`;
