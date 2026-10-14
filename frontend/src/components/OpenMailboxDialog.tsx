import { useEffect, useState } from 'react';
import { ApiError, errorMessage } from '../api/client';
import * as api from '../api/endpoints';
import { useMailboxes } from '../context/MailboxContext';
import { useToast } from '../context/ToastContext';
import { useUi } from '../context/UiContext';
import { ErrorBanner } from './Feedback';
import { Modal } from './Modal';
import { btnPrimary, btnSecondary, hint, input, label } from './ui';

export function OpenMailboxDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addMailbox } = useMailboxes();
  const { toast } = useToast();
  const ui = useUi();
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKey('');
      setError(null);
      setShow(false);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Accept a pasted key file: pick out the mbx_ token if present.
    const match = key.match(/mbx_[A-Za-z0-9_\-.~+/=]+/);
    const token = (match ? match[0] : key).trim();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.openMailbox(token);
      addMailbox(res.mailbox, token);
      toast(`Opened ${res.mailbox.address}`, 'success');
      onClose();
      ui.navigate('inbox');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 401)) {
        setError('No mailbox matches that key. The mailbox may have expired or been deleted, or the key was replaced by a newer one.');
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Open an existing mailbox"
      description="Paste the access key you copied or downloaded when the mailbox was created."
      dismissible={!busy}
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <div>
          <label htmlFor="om-key" className={label}>
            Access key
          </label>
          <div className="flex gap-2">
            <input
              id="om-key"
              className={`${input} font-mono`}
              type={show ? 'text' : 'password'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="mbx_…"
              autoComplete="off"
              spellCheck={false}
              data-autofocus
              required
            />
            <button type="button" className={btnSecondary} onClick={() => setShow((s) => !s)} aria-pressed={show}>
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className={hint}>The key is sent only in a request header and is saved in this browser so you can come back later.</p>
        </div>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy || !key.trim()}>
            {busy ? 'Opening…' : 'Open mailbox'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
