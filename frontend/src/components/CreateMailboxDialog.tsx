import { useEffect, useState } from 'react';
import { ApiError, errorMessage } from '../api/client';
import * as api from '../api/endpoints';
import { useConfig } from '../context/ConfigContext';
import { useMailboxes } from '../context/MailboxContext';
import { useSession } from '../context/SessionContext';
import { useUi } from '../context/UiContext';
import { Modal } from './Modal';
import { ErrorBanner } from './Feedback';
import { btnPrimary, btnSecondary, checkbox, hint, input, label, select } from './ui';

const LOCAL_PART_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;

export function CreateMailboxDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const config = useConfig();
  const { signedIn } = useSession();
  const { addMailbox } = useMailboxes();
  const ui = useUi();
  const [domain, setDomain] = useState(config.default_domain);
  const [localPart, setLocalPart] = useState('');
  const [mbLabel, setMbLabel] = useState('');
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDomain(config.default_domain || config.domains[0] || '');
      setLocalPart('');
      setMbLabel('');
      setSave(false);
      setError(null);
    }
  }, [open, config.default_domain, config.domains]);

  const trimmedLocal = localPart.trim().toLowerCase();
  const localInvalid = trimmedLocal !== '' && !LOCAL_PART_RE.test(trimmedLocal);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (localInvalid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createMailbox({
        domain: domain || undefined,
        local_part: trimmedLocal || undefined,
        label: mbLabel.trim() || undefined,
        save: signedIn && save ? true : undefined,
      });
      addMailbox(res.mailbox, res.token);
      onClose();
      ui.navigate('inbox');
      ui.showKey(res.mailbox, res.token, 'created');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError('That address is already taken. Please try a different name.');
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const hours = config.temp_mailbox_ttl_hours;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a new mailbox"
      description={`You get a fresh address that receives e-mail right away. Temporary mailboxes expire after ${hours} hours.`}
      dismissible={!busy}
    >
      <form id="create-mailbox-form" onSubmit={(e) => void submit(e)} className="space-y-4">
        {config.custom_local_part_allowed && (
          <div>
            <label htmlFor="cm-local" className={label}>
              Custom name <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span>
            </label>
            <div className="flex items-stretch gap-2">
              <input
                id="cm-local"
                className={input}
                value={localPart}
                onChange={(e) => setLocalPart(e.target.value)}
                placeholder="random if left empty"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={40}
                aria-invalid={localInvalid}
                aria-describedby="cm-local-hint"
                data-autofocus
              />
              <span className="self-center text-sm text-slate-600 dark:text-slate-400">@</span>
            </div>
            <p id="cm-local-hint" className={localInvalid ? 'mt-1 text-xs text-red-700 dark:text-red-300' : hint}>
              3–40 characters: lowercase letters, digits, dot, underscore or hyphen. Must start with a letter or digit.
            </p>
          </div>
        )}
        <div>
          <label htmlFor="cm-domain" className={label}>
            Domain
          </label>
          {config.domains.length > 1 ? (
            <select id="cm-domain" className={select} value={domain} onChange={(e) => setDomain(e.target.value)}>
              {config.domains.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          ) : (
            <p id="cm-domain" className="rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm dark:bg-slate-800">
              {domain || 'default domain'}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="cm-label" className={label}>
            Label <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span>
          </label>
          <input
            id="cm-label"
            className={input}
            value={mbLabel}
            onChange={(e) => setMbLabel(e.target.value)}
            placeholder="e.g. Signup tests"
            maxLength={80}
          />
          <p className={hint}>Only you see the label. It helps you tell mailboxes apart.</p>
        </div>
        {signedIn && (
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <input type="checkbox" className={`${checkbox} mt-0.5`} checked={save} onChange={(e) => setSave(e.target.checked)} />
            <span className="text-sm">
              <span className="font-medium">Save to my account</span>
              <span className="block text-slate-600 dark:text-slate-400">
                Saved mailboxes do not expire and are available wherever you sign in. Their messages count toward your storage quota.
              </span>
            </span>
          </label>
        )}
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy || localInvalid}>
            {busy ? 'Creating…' : 'Create mailbox'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
