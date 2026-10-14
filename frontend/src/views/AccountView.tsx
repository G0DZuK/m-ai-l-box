import { useEffect, useState } from 'react';
import { ApiError, errorMessage } from '../api/client';
import * as api from '../api/endpoints';
import { ErrorBanner, InfoBanner, UsageBar } from '../components/Feedback';
import { btnDanger, btnPrimary, btnSmall, card, hint, input, label } from '../components/ui';
import { useMailboxes } from '../context/MailboxContext';
import { useSession } from '../context/SessionContext';
import { useToast } from '../context/ToastContext';
import { useUi } from '../context/UiContext';
import { formatBytes, formatDate } from '../lib/format';

export function AccountView() {
  const session = useSession();
  const { mailboxes, setActive, refreshSaved } = useMailboxes();
  const ui = useUi();
  const { toast } = useToast();

  useEffect(() => {
    void session.refresh();
    void refreshSaved();
    // refresh once when the page opens
  }, []);

  const user = session.user;
  const usage = session.usage;
  const saved = mailboxes.filter((m) => m.saved);

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Account</h1>
          {user && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Signed in as <strong className="text-slate-900 dark:text-white">{user.email}</strong> · member since {formatDate(user.created_at)}
              {user.is_admin && ' · administrator'}
            </p>
          )}
        </div>

        <section className={card} aria-labelledby="acc-usage">
          <h2 id="acc-usage" className="mb-3 text-base font-semibold">
            Storage
          </h2>
          {usage ? (
            <div className="space-y-2">
              <UsageBar used={usage.used_bytes} quota={usage.quota_bytes} label={`${formatBytes(usage.used_bytes)} of ${formatBytes(usage.quota_bytes)} used`} />
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Saved mail: {formatBytes(usage.messages_bytes)} · Files: {formatBytes(usage.files_bytes)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400">Loading…</p>
          )}
        </section>

        <section className={card} aria-labelledby="acc-mailboxes">
          <h2 id="acc-mailboxes" className="mb-3 text-base font-semibold">
            Saved mailboxes
          </h2>
          {saved.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              None yet. Open a mailbox&rsquo;s settings menu and choose &ldquo;Save to my account&rdquo; so it never expires.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {saved.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="break-all font-mono text-sm">{m.address}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      {m.label ? `${m.label} · ` : ''}
                      {m.info ? `${m.info.message_count} messages · ${formatBytes(m.info.storage_bytes)}` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={btnSmall}
                    onClick={() => {
                      setActive(m.id);
                      ui.navigate('inbox');
                    }}
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <ChangePassword />
        <DeleteAccount onDeleted={() => toast('Your account was deleted.', 'success')} />
      </div>
    </div>
  );
}

function ChangePassword() {
  const { toast } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 10) return setError('The new password must have at least 10 characters.');
    if (next !== confirm) return setError('The two new passwords do not match.');
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      toast('Password changed. Other devices have been signed out.', 'success');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 401 || err.status === 403)) setError('Your current password is not correct.');
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={card} aria-labelledby="acc-password">
      <h2 id="acc-password" className="mb-3 text-base font-semibold">
        Change password
      </h2>
      <form onSubmit={(e) => void submit(e)} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="pw-current" className={label}>
            Current password
          </label>
          <input id="pw-current" type="password" className={input} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </div>
        <div>
          <label htmlFor="pw-new" className={label}>
            New password
          </label>
          <input id="pw-new" type="password" className={input} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} required />
          <p className={hint}>At least 10 characters.</p>
        </div>
        <div>
          <label htmlFor="pw-confirm" className={label}>
            Repeat new password
          </label>
          <input id="pw-confirm" type="password" className={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </div>
        {error && <ErrorBanner message={error} className="sm:col-span-2" />}
        <div className="sm:col-span-2">
          <button type="submit" className={btnPrimary} disabled={busy || !current || !next || !confirm}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </form>
    </section>
  );
}

function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
  const session = useSession();
  const ui = useUi();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(password);
      session.clear();
      onDeleted();
      ui.navigate('inbox');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 401 || err.status === 403)) setError('That password is not correct.');
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`${card} border-red-200 dark:border-red-900`} aria-labelledby="acc-delete">
      <h2 id="acc-delete" className="mb-2 text-base font-semibold text-red-800 dark:text-red-300">
        Delete account
      </h2>
      <InfoBanner tone="warn">
        This permanently deletes your account, all saved mailboxes with their messages, your files and API keys. Temporary mailboxes kept only in
        this browser are not affected. This cannot be undone.
      </InfoBanner>
      <form onSubmit={(e) => void submit(e)} className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <label htmlFor="del-password" className={label}>
            Confirm with your password
          </label>
          <input id="del-password" type="password" className={input} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        <button type="submit" className={btnDanger} disabled={busy || !password}>
          {busy ? 'Deleting…' : 'Delete my account'}
        </button>
        {error && <ErrorBanner message={error} className="w-full" />}
      </form>
    </section>
  );
}
