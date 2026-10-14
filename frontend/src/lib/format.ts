// Formatting helpers (sizes, dates, durations) built on Intl.

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = v >= 100 || Number.isInteger(v) ? 0 : 1;
  return `${v.toFixed(digits)} ${units[i]}`;
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const fullFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
});
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const dayYearFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });

/** Full timestamp with seconds and time zone, for tooltips and the reading pane. */
export function formatFull(iso: string | null | undefined): string {
  const d = toDate(iso);
  return d ? fullFmt.format(d) : '—';
}

export function formatDateTime(iso: string | null | undefined): string {
  const d = toDate(iso);
  return d ? dateTimeFmt.format(d) : '—';
}

export function formatDate(iso: string | null | undefined): string {
  const d = toDate(iso);
  return d ? dayYearFmt.format(d) : '—';
}

/** List time: relative for today ("5 min ago"), a short date otherwise. */
export function formatListTime(iso: string | null | undefined, now: number = Date.now()): string {
  const d = toDate(iso);
  if (!d) return '';
  const today = new Date(now);
  const sameDay =
    d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  if (sameDay) {
    const diffSec = Math.round((d.getTime() - now) / 1000);
    if (diffSec > -45 && diffSec < 60) return 'just now';
    if (diffSec > -3600) return rtf.format(Math.round(diffSec / 60), 'minute');
    if (diffSec > -6 * 3600) return rtf.format(Math.round(diffSec / 3600), 'hour');
    return timeFmt.format(d);
  }
  return d.getFullYear() === today.getFullYear() ? dayFmt.format(d) : dayYearFmt.format(d);
}

export function formatRelative(iso: string | null | undefined, now: number = Date.now()): string {
  const d = toDate(iso);
  if (!d) return '—';
  const diffSec = Math.round((d.getTime() - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 30 * 86400) return rtf.format(Math.round(diffSec / 86400), 'day');
  return dayYearFmt.format(d);
}

/** Human duration like "2 h 5 min", "3 min 12 s", "45 s". */
export function formatDuration(ms: number): string {
  let s = Math.round(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d > 0) return h ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return s ? `${m} min ${s} s` : `${m} min`;
  return `${s} s`;
}

export interface ExpiryInfo {
  /** Short text, e.g. "Expires in 23 h", "Expired", "No expiry". */
  text: string;
  expired: boolean;
  soon: boolean;
  never: boolean;
}

export function expiryInfo(expiresAt: string | null | undefined, now: number = Date.now()): ExpiryInfo {
  const d = toDate(expiresAt);
  if (!d) return { text: 'No expiry', expired: false, soon: false, never: true };
  const ms = d.getTime() - now;
  if (ms <= 0) return { text: 'Expired', expired: true, soon: false, never: false };
  const mins = Math.floor(ms / 60000);
  let left: string;
  if (mins < 1) left = 'less than a minute';
  else if (mins < 60) left = `${mins} min`;
  else if (mins < 48 * 60) left = `${Math.floor(mins / 60)} h`;
  else left = `${Math.floor(mins / 1440)} days`;
  return { text: `Expires in ${left}`, expired: false, soon: ms < 60 * 60000, never: false };
}

/** Describe the gap between when we received a message and its Date: header. */
export function describeDateDelta(receivedAt: string, sentAt: string | null): string | null {
  const r = toDate(receivedAt);
  const s = toDate(sentAt);
  if (!r || !s) return null;
  const diff = r.getTime() - s.getTime();
  if (Math.abs(diff) < 1000) return 'Same second as the sender’s Date header.';
  if (diff > 0) return `Received ${formatDuration(diff)} after the sender’s Date header.`;
  return `The sender’s Date header is ${formatDuration(diff)} later than our receive time (the sender’s clock may be ahead).`;
}

export function displayAddress(a: { name: string | null; address: string } | null | undefined): string {
  if (!a) return '(unknown sender)';
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

export function senderLabel(a: { name: string | null; address: string } | null | undefined): string {
  if (!a) return '(unknown sender)';
  return a.name || a.address;
}

export function pluralize(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : many ?? one + 's'}`;
}

export function humanizeKey(key: string): string {
  const s = key.replace(/[_.-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
