// Typed fetch wrapper for the M-Ai-L Box REST API.
// Credentials are ONLY ever sent in headers, never in URLs or query strings.

export const API_BASE = '/api';

export class ApiError extends Error {
  status: number;
  detail: unknown;
  retryAfter: number | null;

  constructor(status: number, message: string, detail?: unknown, retryAfter: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.retryAfter = retryAfter;
  }
}

// ---- Credential registry -------------------------------------------------
// The session token and per-mailbox tokens are registered here by the React
// contexts, so every request can attach the right headers automatically.

let sessionToken: string | null = null;
const mailboxTokens = new Map<string, string>();

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

export function getSessionToken(): string | null {
  return sessionToken;
}

export function setMailboxTokens(entries: Array<{ id: string; token: string | null | undefined }>): void {
  mailboxTokens.clear();
  for (const e of entries) {
    if (e.token) mailboxTokens.set(e.id, e.token);
  }
}

export function setMailboxToken(id: string, token: string): void {
  mailboxTokens.set(id, token);
}

export function getMailboxToken(id: string): string | null {
  return mailboxTokens.get(id) ?? null;
}

// ---- Request helpers ------------------------------------------------------

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  /** Attach X-Mailbox-Token for this mailbox (if this browser knows its token). */
  mailboxId?: string;
  /** Explicit mailbox token (overrides the registry). */
  mailboxToken?: string;
  /** Do not send the session token even if signed in. */
  noSession?: boolean;
  signal?: AbortSignal;
}

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  let url = API_BASE + path;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '' || v === false) continue;
      params.set(k, String(v));
    }
    const s = params.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  return url;
}

export function authHeaders(opts: { mailboxId?: string; mailboxToken?: string; noSession?: boolean } = {}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (sessionToken && !opts.noSession) headers['Authorization'] = `Bearer ${sessionToken}`;
  const mbx = opts.mailboxToken ?? (opts.mailboxId ? getMailboxToken(opts.mailboxId) : null);
  if (mbx) headers['X-Mailbox-Token'] = mbx;
  return headers;
}

function describeStatus(status: number): string {
  switch (status) {
    case 400:
      return 'The request was not valid.';
    case 401:
      return 'Please sign in again.';
    case 403:
      return 'You are not allowed to do that.';
    case 404:
      return 'Not found, or you no longer have access to it.';
    case 408:
      return 'The request timed out.';
    case 409:
      return 'That conflicts with something that already exists.';
    case 413:
      return 'That is too large.';
    case 422:
      return 'Some fields are not valid.';
    case 429:
      return 'Too many requests. Please slow down.';
    case 507:
      return 'Your storage quota is full.';
    default:
      return status >= 500 ? 'The server had a problem. Please try again.' : `Request failed (${status}).`;
  }
}

/** Turn FastAPI's `{detail}` (string or 422 array) into a readable sentence. */
export function detailToMessage(detail: unknown): string | null {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d) => {
        if (d && typeof d === 'object' && 'msg' in d) {
          const item = d as { msg: unknown; loc?: unknown };
          const loc = Array.isArray(item.loc) ? item.loc.filter((x) => x !== 'body' && x !== 'query').join('.') : '';
          return loc ? `${loc}: ${String(item.msg)}` : String(item.msg);
        }
        return typeof d === 'string' ? d : null;
      })
      .filter(Boolean);
    return parts.length ? parts.join('; ') : null;
  }
  return null;
}

export async function errorFromResponse(res: Response): Promise<ApiError> {
  let detail: unknown;
  try {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = (await res.json()) as { detail?: unknown };
      detail = data?.detail;
    } else {
      const text = await res.text();
      detail = text && text.length < 300 ? text : undefined;
    }
  } catch {
    detail = undefined;
  }
  let retryAfter: number | null = null;
  let message = detailToMessage(detail) || describeStatus(res.status);
  if (res.status === 429) {
    const ra = res.headers.get('Retry-After');
    const secs = ra ? parseInt(ra, 10) : NaN;
    retryAfter = Number.isFinite(secs) ? secs : null;
    message = retryAfter
      ? `Too many requests. Please wait ${retryAfter} second${retryAfter === 1 ? '' : 's'} and try again.`
      : 'Too many requests. Please wait a moment and try again.';
  }
  return new ApiError(res.status, message, detail, retryAfter);
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...authHeaders(opts),
  };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body,
      signal: opts.signal,
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'Could not reach the M-Ai-L Box server. Check your connection and try again.');
  }
  if (!res.ok) throw await errorFromResponse(res);
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    const text = await res.text();
    return (text ? (text as unknown) : undefined) as T;
  }
  return (await res.json()) as T;
}

export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}

// ---- Multipart upload with progress (XMLHttpRequest) ----------------------

export function uploadWithProgress<T>(
  path: string,
  formData: FormData,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', buildUrl(path));
    const headers = authHeaders();
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) onProgress(ev.loaded / ev.total);
    };
    xhr.onload = () => {
      let data: unknown = undefined;
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        data = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve(data as T);
        return;
      }
      const detail = data && typeof data === 'object' ? (data as { detail?: unknown }).detail : undefined;
      let msg = detailToMessage(detail) || describeStatus(xhr.status);
      let retryAfter: number | null = null;
      if (xhr.status === 429) {
        const secs = parseInt(xhr.getResponseHeader('Retry-After') || '', 10);
        retryAfter = Number.isFinite(secs) ? secs : null;
        msg = retryAfter ? `Too many requests. Please wait ${retryAfter} seconds and try again.` : describeStatus(429);
      }
      reject(new ApiError(xhr.status, msg, detail, retryAfter));
    };
    xhr.onerror = () => reject(new ApiError(0, 'The upload failed. Check your connection and try again.'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(formData);
  });
}
