// Safe localStorage access: every read/write is wrapped in try/catch because
// storage can be unavailable (private mode, blocked site data, quota).

export const KEYS = {
  mailboxes: 'mailbox.v1',
  session: 'session.v1',
  theme: 'theme.v1',
  active: 'active.v1',
} as const;

export function readString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string | null): boolean {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = readString(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  try {
    return writeString(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

/** Credentials for a mailbox this browser knows. Stored under `mailbox.v1`. */
export interface StoredMailbox {
  id: string;
  address: string;
  token: string;
  label: string | null;
  expires_at: string | null;
  is_demo: boolean;
}

function isStoredMailbox(x: unknown): x is StoredMailbox {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.address === 'string' && typeof o.token === 'string';
}

export function loadStoredMailboxes(): StoredMailbox[] {
  const data = readJson<unknown>(KEYS.mailboxes, []);
  if (!Array.isArray(data)) return [];
  return data.filter(isStoredMailbox).map((m) => ({
    id: m.id,
    address: m.address,
    token: m.token,
    label: typeof m.label === 'string' ? m.label : null,
    expires_at: typeof m.expires_at === 'string' ? m.expires_at : null,
    is_demo: m.is_demo === true,
  }));
}

export function saveStoredMailboxes(list: StoredMailbox[]): boolean {
  return writeJson(KEYS.mailboxes, list);
}
