import { useState } from 'react';
import { errorMessage } from '../api/client';
import { ALL_SCOPES, type ApiKey, type ApiScope } from '../api/types';
import { formatDateTime, formatRelative } from '../lib/format';
import { CopyButton } from './CopyButton';
import { ConfirmDialog } from './ConfirmDialog';
import { Badge, ErrorBanner, InfoBanner } from './Feedback';
import { btnPrimary, btnSmall, checkbox, hint, input, label, select } from './ui';

const SCOPE_HELP: Record<ApiScope, string> = {
  'mailboxes:create': 'Create new mailboxes',
  'messages:read': 'List and read messages, wait for new mail',
  'messages:write': 'Mark read, star, trash and delete messages',
  'attachments:read': 'Download attachments',
};

interface CreateFormProps {
  /** Scopes that make sense in this context (mailbox-bound keys cannot create mailboxes). */
  scopes?: ApiScope[];
  mailboxOptions?: Array<{ id: string; address: string }>;
  onCreate: (body: { name: string; scopes: ApiScope[]; mailbox_id?: string }) => Promise<void>;
}

export function ApiKeyCreateForm({ scopes = ALL_SCOPES, mailboxOptions, onCreate }: CreateFormProps) {
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<ApiScope[]>(['messages:read']);
  const [mailboxId, setMailboxId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (s: ApiScope) => setChosen((c) => (c.includes(s) ? c.filter((x) => x !== s) : [...c, s]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || chosen.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), scopes: chosen, mailbox_id: mailboxId || undefined });
      setName('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      <div>
        <label htmlFor="ak-name" className={label}>
          Key name
        </label>
        <input id="ak-name" className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CI pipeline" maxLength={80} required />
      </div>
      <fieldset>
        <legend className={label}>Permissions</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {scopes.map((s) => (
            <label key={s} className="flex items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm dark:border-slate-700">
              <input type="checkbox" className={`${checkbox} mt-0.5`} checked={chosen.includes(s)} onChange={() => toggle(s)} />
              <span>
                <span className="font-mono text-xs">{s}</span>
                <span className="block text-xs text-slate-600 dark:text-slate-400">{SCOPE_HELP[s]}</span>
              </span>
            </label>
          ))}
        </div>
        {chosen.length === 0 && <p className="mt-1 text-xs text-red-700 dark:text-red-300">Choose at least one permission.</p>}
      </fieldset>
      {mailboxOptions && (
        <div>
          <label htmlFor="ak-mailbox" className={label}>
            Limit to one mailbox <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span>
          </label>
          <select id="ak-mailbox" className={select} value={mailboxId} onChange={(e) => setMailboxId(e.target.value)}>
            <option value="">All my saved mailboxes</option>
            {mailboxOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.address}
              </option>
            ))}
          </select>
          <p className={hint}>A key limited to one mailbox cannot see your other mailboxes.</p>
        </div>
      )}
      {error && <ErrorBanner message={error} />}
      <button type="submit" className={btnPrimary} disabled={busy || !name.trim() || chosen.length === 0}>
        {busy ? 'Creating…' : 'Create API key'}
      </button>
    </form>
  );
}

export function NewKeyNotice({ secret, onDismiss }: { secret: string; onDismiss: () => void }) {
  return (
    <InfoBanner tone="warn">
      <p className="font-semibold">Copy your new API key now — it will not be shown again.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="break-all rounded bg-white px-2 py-1 font-mono text-xs text-slate-900 ring-1 ring-amber-300 dark:bg-slate-900 dark:text-slate-100 dark:ring-amber-700">
          {secret}
        </code>
        <CopyButton text={secret} label="Copy key" ariaLabel="Copy API key" />
        <button type="button" className={btnSmall} onClick={onDismiss}>
          I have saved it
        </button>
      </div>
    </InfoBanner>
  );
}

interface TableProps {
  keys: ApiKey[];
  mailboxLabel?: (id: string) => string;
  onRevoke: (key: ApiKey) => Promise<void>;
}

export function ApiKeyTable({ keys, mailboxLabel, onRevoke }: TableProps) {
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  if (keys.length === 0) return <p className="text-sm text-slate-600 dark:text-slate-400">No API keys yet.</p>;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-600 dark:border-slate-700 dark:text-slate-400">
            <tr>
              <th scope="col" className="py-2 pr-3 font-semibold">Name</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Key</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Permissions</th>
              <th scope="col" className="py-2 pr-3 font-semibold">Last used</th>
              <th scope="col" className="py-2 font-semibold"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-b border-slate-100 align-top last:border-0 dark:border-slate-800">
                <td className="py-2 pr-3">
                  <div className="font-medium">{k.name}</div>
                  <div className="text-xs text-slate-600 dark:text-slate-400" title={formatDateTime(k.created_at)}>
                    Created {formatRelative(k.created_at)}
                    {k.mailbox_id && mailboxLabel && <> · {mailboxLabel(k.mailbox_id)}</>}
                  </div>
                </td>
                <td className="py-2 pr-3 font-mono text-xs">{k.prefix}…</td>
                <td className="py-2 pr-3">
                  <div className="flex flex-wrap gap-1">
                    {k.scopes.map((s) => (
                      <Badge key={s} tone="indigo" className="normal-case tracking-normal">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="py-2 pr-3 text-xs" title={k.last_used_at ? formatDateTime(k.last_used_at) : undefined}>
                  {k.last_used_at ? formatRelative(k.last_used_at) : 'Never'}
                </td>
                <td className="py-2 text-right">
                  <button type="button" className={`${btnSmall} text-red-700 dark:text-red-300`} onClick={() => setRevoking(k)}>
                    Revoke
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={!!revoking}
        title="Revoke API key?"
        confirmLabel="Revoke key"
        danger
        onClose={() => setRevoking(null)}
        onConfirm={async () => {
          if (revoking) await onRevoke(revoking);
        }}
      >
        <p>
          Scripts using <strong>{revoking?.name}</strong> ({revoking?.prefix}…) will stop working immediately. This cannot be undone.
        </p>
      </ConfirmDialog>
    </>
  );
}

export function WaitSnippet({ mailboxId, waitMax }: { mailboxId?: string; waitMax: number }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const id = mailboxId ?? '<mailbox-id>';
  const timeout = Math.min(60, waitMax);
  const snippet = [
    '# Wait (up to ' + timeout + ' s) for a message whose subject contains "Verify"',
    'SINCE=$(date -u +%Y-%m-%dT%H:%M:%SZ)',
    '# ... trigger the e-mail in your app here ...',
    `curl -sS -H "Authorization: Bearer $MAIL_API_KEY" \\`,
    `  "${origin}/api/mailboxes/${id}/wait?since=$SINCE&subject=Verify&timeout=${timeout}"`,
  ].join('\n');
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Example: wait for an e-mail in a test</span>
        <CopyButton text={snippet} label="Copy" ariaLabel="Copy curl example" />
      </div>
      <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100 dark:bg-black">{snippet}</pre>
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
        Returns the full message as JSON (including <span className="font-mono">otp_codes</span> and <span className="font-mono">links</span>), or
        HTTP 408 if nothing matching arrives in time. Keep the key in an environment variable, never in a URL.
      </p>
    </div>
  );
}
