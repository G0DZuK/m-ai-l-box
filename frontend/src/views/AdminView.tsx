import { useCallback, useEffect, useState } from 'react';
import { errorMessage, isAbort } from '../api/client';
import * as api from '../api/endpoints';
import type { AdminBlock, AdminDelivery, AdminOverview, AdminUser, BlockKind } from '../api/types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Badge, ErrorBanner, InfoBanner, Spinner, UsageBar } from '../components/Feedback';
import { btnPrimary, btnSecondary, btnSmall, card, focusRing, hint, input, label, select } from '../components/ui';
import { useSession } from '../context/SessionContext';
import { useToast } from '../context/ToastContext';
import { cx } from '../lib/cx';
import { formatBytes, formatDateTime, formatFull, formatRelative, humanizeKey } from '../lib/format';

type Tab = 'overview' | 'deliveries' | 'users' | 'blocks' | 'tools';

const TABS: Array<[Tab, string]> = [
  ['overview', 'Overview'],
  ['deliveries', 'Deliveries'],
  ['users', 'Users'],
  ['blocks', 'Blocklist'],
  ['tools', 'Tools'],
];

export function AdminView() {
  const { isAdmin } = useSession();
  const [tab, setTab] = useState<Tab>('overview');

  if (!isAdmin) {
    return (
      <div className="flex-1 p-6">
        <ErrorBanner message="This page is only available to administrators." />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Administration</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Service health and moderation. Message content is never shown here.</p>
        </div>
        <div role="tablist" aria-label="Admin sections" className="flex flex-wrap gap-1 rounded-lg bg-slate-200/70 p-1 dark:bg-slate-800">
          {TABS.map(([id, text]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`admin-${id}`}
              id={`admin-tab-${id}`}
              onClick={() => setTab(id)}
              className={cx(
                'rounded-md px-3 py-1.5 text-sm font-medium',
                focusRing,
                tab === id ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white' : 'text-slate-700 hover:text-slate-900 dark:text-slate-300',
              )}
            >
              {text}
            </button>
          ))}
        </div>
        <div role="tabpanel" id={`admin-${tab}`} aria-labelledby={`admin-tab-${tab}`}>
          {tab === 'overview' && <OverviewTab />}
          {tab === 'deliveries' && <DeliveriesTab />}
          {tab === 'users' && <UsersTab />}
          {tab === 'blocks' && <BlocksTab />}
          {tab === 'tools' && <ToolsTab />}
        </div>
      </div>
    </div>
  );
}

// ---- Overview (rendered generically: the shape is loosely specified) ------

const STATUS_WORDS = new Set(['ok', 'healthy', 'up', 'degraded', 'unavailable', 'down', 'error', 'failed', 'disabled']);

function renderValue(key: string, v: unknown) {
  if (v === null || v === undefined) return <span className="text-slate-500">—</span>;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') {
    if (/bytes/i.test(key)) return formatBytes(v);
    return v.toLocaleString();
  }
  if (typeof v === 'string') {
    const lower = v.toLowerCase();
    if (STATUS_WORDS.has(lower)) {
      const tone = lower === 'ok' || lower === 'healthy' || lower === 'up' ? 'green' : lower === 'degraded' || lower === 'disabled' ? 'amber' : 'red';
      return <Badge tone={tone}>{v}</Badge>;
    }
    if (/_at$|time|date/i.test(key) && !Number.isNaN(Date.parse(v))) return <span title={formatFull(v)}>{formatDateTime(v)}</span>;
    return <span className="break-all">{v}</span>;
  }
  if (Array.isArray(v)) return <span className="break-all font-mono text-xs">{v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') || '—'}</span>;
  return <span className="break-all font-mono text-xs">{JSON.stringify(v)}</span>;
}

function flatten(obj: Record<string, unknown>, prefix = '', depth = 0): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix} › ${humanizeKey(k)}` : humanizeKey(k);
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) out.push(...flatten(v as Record<string, unknown>, key, depth + 1));
    else out.push([key, v]);
  }
  return out;
}

function OverviewTab() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    api
      .adminOverview(ctrl.signal)
      .then(setData)
      .catch((e) => {
        if (!isAbort(e)) setError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [attempt]);

  if (error) return <ErrorBanner message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!data) return <Spinner className="h-6 w-6" label="Loading overview" />;

  const primitives = Object.entries(data).filter(([, v]) => v === null || typeof v !== 'object' || Array.isArray(v));
  const groups = Object.entries(data).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v)) as Array<[string, Record<string, unknown>]>;

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button type="button" className={btnSecondary} onClick={() => setAttempt((n) => n + 1)}>
          Refresh
        </button>
      </div>
      {primitives.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {primitives.map(([k, v]) => (
            <div key={k} className={card}>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">{humanizeKey(k)}</div>
              <div className="mt-1 text-xl font-semibold text-slate-900 dark:text-white">{renderValue(k, v)}</div>
            </div>
          ))}
        </div>
      )}
      {groups.map(([k, v]) => (
        <section key={k} className={card} aria-label={humanizeKey(k)}>
          <h2 className="mb-3 text-base font-semibold">{humanizeKey(k)}</h2>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {flatten(v).map(([key, val]) => (
              <div key={key} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                <dt className="text-xs text-slate-600 dark:text-slate-400">{key}</dt>
                <dd className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">{renderValue(key, val)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

// ---- Deliveries -----------------------------------------------------------

function DeliveriesTab() {
  const { toast } = useToast();
  const [status, setStatus] = useState('failed');
  const [items, setItems] = useState<AdminDelivery[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setItems(null);
    setError(null);
    api
      .adminDeliveries(status, undefined, ctrl.signal)
      .then((res) => {
        setItems(res.items);
        setCursor(res.next_cursor);
      })
      .catch((e) => {
        if (!isAbort(e)) setError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [status, attempt]);

  const more = async () => {
    if (!cursor) return;
    try {
      const res = await api.adminDeliveries(status, cursor);
      setItems((p) => [...(p ?? []), ...res.items]);
      setCursor(res.next_cursor);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const retry = async (d: AdminDelivery) => {
    try {
      await api.adminRetryDelivery(d.id);
      toast('Delivery re-queued.', 'success');
      setAttempt((n) => n + 1);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="dl-status" className={label}>
            Status
          </label>
          <select id="dl-status" className={select} value={status} onChange={(e) => setStatus(e.target.value)}>
            {['failed', 'queued', 'processing', 'processed', 'rejected'].map((s) => (
              <option key={s} value={s}>
                {humanizeKey(s)}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className={btnSecondary} onClick={() => setAttempt((n) => n + 1)}>
          Refresh
        </button>
      </div>
      {error && <ErrorBanner message={error} onRetry={() => setAttempt((n) => n + 1)} />}
      {!items && !error && <Spinner label="Loading deliveries" />}
      {items && items.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-400">No {status} deliveries.</p>}
      {items && items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th scope="col" className="px-3 py-2">Received</th>
                <th scope="col" className="px-3 py-2">Source</th>
                <th scope="col" className="px-3 py-2">Recipients</th>
                <th scope="col" className="px-3 py-2">Size</th>
                <th scope="col" className="px-3 py-2">Attempts</th>
                <th scope="col" className="px-3 py-2">Last error</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                  <td className="whitespace-nowrap px-3 py-2" title={formatFull(d.received_at)}>
                    {formatRelative(d.received_at)}
                  </td>
                  <td className="px-3 py-2">
                    {d.source} <Badge tone={d.status === 'failed' || d.status === 'rejected' ? 'red' : d.status === 'processed' ? 'green' : 'amber'}>{d.status}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div>{d.recipient_count} ({d.matched_count} matched)</div>
                    <div className="break-all text-xs text-slate-600 dark:text-slate-400">{d.recipient_domains.join(', ')}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{formatBytes(d.size_bytes)}</td>
                  <td className="px-3 py-2">{d.attempts}</td>
                  <td className="max-w-xs break-words px-3 py-2 font-mono text-xs">{d.last_error ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {d.status === 'failed' && (
                      <button type="button" className={btnSmall} onClick={() => void retry(d)}>
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {cursor && (
        <button type="button" className={btnSecondary} onClick={() => void more()}>
          Load more
        </button>
      )}
    </div>
  );
}

// ---- Users ----------------------------------------------------------------

function UsersTab() {
  const { toast } = useToast();
  const { user: me } = useSession();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [quotaEdit, setQuotaEdit] = useState<Record<string, string>>({});

  useEffect(() => {
    const t = window.setTimeout(() => setQ(qInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    api
      .adminUsers(q, ctrl.signal)
      .then((res) => setUsers(res.items))
      .catch((e) => {
        if (!isAbort(e)) setError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [q, attempt]);

  const patch = async (u: AdminUser, body: { quota_bytes?: number; disabled?: boolean }) => {
    try {
      await api.adminPatchUser(u.id, body);
      setUsers((list) => (list ? list.map((x) => (x.id === u.id ? { ...x, ...body } : x)) : list));
      toast(`Updated ${u.email}.`, 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const saveQuota = (u: AdminUser) => {
    const raw = quotaEdit[u.id];
    const mb = Number(raw);
    if (!raw || !Number.isFinite(mb) || mb < 0) {
      toast('Enter a quota in MB (0 or more).', 'error');
      return;
    }
    void patch(u, { quota_bytes: Math.round(mb * 1024 * 1024) }).then(() =>
      setQuotaEdit((m) => {
        const n = { ...m };
        delete n[u.id];
        return n;
      }),
    );
  };

  return (
    <div className="space-y-3">
      <div className="max-w-sm">
        <label htmlFor="users-q" className={label}>
          Search users
        </label>
        <input id="users-q" type="search" className={input} value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="e-mail" />
      </div>
      {error && <ErrorBanner message={error} onRetry={() => setAttempt((n) => n + 1)} />}
      {!users && !error && <Spinner label="Loading users" />}
      {users && users.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-400">No users found.</p>}
      {users && users.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th scope="col" className="px-3 py-2">User</th>
                <th scope="col" className="px-3 py-2">Mailboxes</th>
                <th scope="col" className="px-3 py-2">Storage</th>
                <th scope="col" className="px-3 py-2">Quota (MB)</th>
                <th scope="col" className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const editing = quotaEdit[u.id] !== undefined;
                return (
                  <tr key={u.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                    <td className="px-3 py-2">
                      <div className="break-all font-medium">{u.email}</div>
                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        Joined {formatRelative(u.created_at)}
                        {u.is_admin && ' · admin'}
                      </div>
                    </td>
                    <td className="px-3 py-2">{u.mailbox_count}</td>
                    <td className="min-w-[10rem] px-3 py-2">
                      <UsageBar used={u.used_bytes} quota={u.quota_bytes} label={`${formatBytes(u.used_bytes)} of ${formatBytes(u.quota_bytes)}`} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <label htmlFor={`quota-${u.id}`} className="sr-only">
                          Quota in MB for {u.email}
                        </label>
                        <input
                          id={`quota-${u.id}`}
                          type="number"
                          min={0}
                          className={cx(input, 'w-28 py-1')}
                          value={editing ? quotaEdit[u.id] : String(Math.round(u.quota_bytes / (1024 * 1024)))}
                          onChange={(e) => setQuotaEdit((m) => ({ ...m, [u.id]: e.target.value }))}
                        />
                        {editing && (
                          <button type="button" className={btnSmall} onClick={() => saveQuota(u)}>
                            Save
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {u.disabled ? <Badge tone="red">Disabled</Badge> : <Badge tone="green">Active</Badge>}
                        {u.id !== me?.id && (
                          <button type="button" className={btnSmall} onClick={() => void patch(u, { disabled: !u.disabled })}>
                            {u.disabled ? 'Enable' : 'Disable'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Blocklist ------------------------------------------------------------

const KIND_HELP: Record<BlockKind, string> = {
  sender: 'A full sender address, e.g. spam@example.org',
  sender_domain: 'A sending domain, e.g. example.org',
  ip: 'An IP address of a sending server',
  mailbox: 'A full M-Ai-L Box address that should stop receiving mail',
};

function BlocksTab() {
  const { toast } = useToast();
  const [blocks, setBlocks] = useState<AdminBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [kind, setKind] = useState<BlockKind>('sender');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<AdminBlock | null>(null);

  const load = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    api
      .adminBlocks(ctrl.signal)
      .then((res) => setBlocks(res.items))
      .catch((e) => {
        if (!isAbort(e)) setError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [attempt]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    try {
      await api.adminAddBlock({
        kind,
        value: value.trim(),
        reason: reason.trim() || undefined,
        expires_at: expires ? new Date(expires).toISOString() : undefined,
      });
      setValue('');
      setReason('');
      setExpires('');
      toast('Block added.', 'success');
      load();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <form onSubmit={(e) => void add(e)} className={cx(card, 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4')} aria-label="Add a block">
        <div>
          <label htmlFor="blk-kind" className={label}>
            Type
          </label>
          <select id="blk-kind" className={select} value={kind} onChange={(e) => setKind(e.target.value as BlockKind)}>
            <option value="sender">Sender address</option>
            <option value="sender_domain">Sender domain</option>
            <option value="ip">IP address</option>
            <option value="mailbox">Mailbox address</option>
          </select>
        </div>
        <div className="lg:col-span-1">
          <label htmlFor="blk-value" className={label}>
            Value
          </label>
          <input id="blk-value" className={input} value={value} onChange={(e) => setValue(e.target.value)} required />
          <p className={hint}>{KIND_HELP[kind]}</p>
        </div>
        <div>
          <label htmlFor="blk-reason" className={label}>
            Reason <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input id="blk-reason" className={input} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div>
          <label htmlFor="blk-expires" className={label}>
            Expires <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <input id="blk-expires" type="datetime-local" className={input} value={expires} onChange={(e) => setExpires(e.target.value)} />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <button type="submit" className={btnPrimary} disabled={busy || !value.trim()}>
            {busy ? 'Adding…' : 'Add block'}
          </button>
        </div>
      </form>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {!blocks && !error && <Spinner label="Loading blocklist" />}
      {blocks && blocks.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-400">The blocklist is empty.</p>}
      {blocks && blocks.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
          {blocks.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <Badge tone="neutral">{humanizeKey(b.kind)}</Badge>
              <span className="min-w-0 flex-1 break-all font-mono">{b.value}</span>
              <span className="text-xs text-slate-600 dark:text-slate-400">
                {b.reason ? `${b.reason} · ` : ''}added {formatRelative(b.created_at)}
                {b.expires_at ? ` · expires ${formatDateTime(b.expires_at)}` : ''}
              </span>
              <button type="button" className={btnSmall} onClick={() => setRemoving(b)} aria-label={`Remove block ${b.value}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!removing}
        title="Remove block?"
        confirmLabel="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await api.adminDeleteBlock(removing.id);
          setBlocks((bs) => (bs ? bs.filter((x) => x.id !== removing.id) : bs));
        }}
      >
        <p>
          Mail matching <span className="break-all font-mono">{removing?.value}</span> will be accepted again.
        </p>
      </ConfirmDialog>
    </div>
  );
}

// ---- Tools ----------------------------------------------------------------

function ToolsTab() {
  const { toast } = useToast();
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<Record<string, unknown> | null>(null);
  const [confirmCleanup, setConfirmCleanup] = useState(false);

  const setDisabled = async (disabled: boolean) => {
    if (!address.trim()) return;
    setBusy(true);
    try {
      const res = await api.adminDisableMailbox(address.trim(), disabled);
      toast(`${res.address} is now ${res.disabled ? 'disabled' : 'enabled'}.`, 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className={card} aria-labelledby="tool-disable">
        <h2 id="tool-disable" className="mb-1 text-base font-semibold">
          Disable a mailbox
        </h2>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">A disabled mailbox stops receiving mail and cannot be opened. Its content is not shown.</p>
        <label htmlFor="tool-address" className={label}>
          Mailbox address
        </label>
        <input id="tool-address" className={input} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="name@domain" />
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} disabled={busy || !address.trim()} onClick={() => void setDisabled(true)}>
            Disable
          </button>
          <button type="button" className={btnSecondary} disabled={busy || !address.trim()} onClick={() => void setDisabled(false)}>
            Enable
          </button>
        </div>
      </section>

      <section className={card} aria-labelledby="tool-cleanup">
        <h2 id="tool-cleanup" className="mb-1 text-base font-semibold">
          Retention cleanup
        </h2>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
          Removes expired mailboxes, trashed messages past their retention and orphaned files right now, instead of waiting for the scheduled run.
        </p>
        <button type="button" className={btnPrimary} onClick={() => setConfirmCleanup(true)}>
          Run cleanup now
        </button>
        {cleanupResult && (
          <InfoBanner className="mt-3">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              {Object.entries(cleanupResult).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt>{humanizeKey(k)}</dt>
                  <dd className="font-semibold">{typeof v === 'number' ? v.toLocaleString() : JSON.stringify(v)}</dd>
                </div>
              ))}
            </dl>
          </InfoBanner>
        )}
      </section>

      <ConfirmDialog
        open={confirmCleanup}
        title="Run cleanup now?"
        confirmLabel="Run cleanup"
        onClose={() => setConfirmCleanup(false)}
        onConfirm={async () => {
          const res = await api.adminCleanup();
          setCleanupResult(res && typeof res === 'object' ? res : {});
          toast('Cleanup finished.', 'success');
        }}
      >
        <p>Expired data will be permanently deleted according to the configured retention rules.</p>
      </ConfirmDialog>
    </div>
  );
}
