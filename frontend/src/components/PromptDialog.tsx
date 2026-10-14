import { useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import { ErrorBanner } from './Feedback';
import { Modal } from './Modal';
import { btnPrimary, btnSecondary, hint, input, label as labelCls } from './ui';

interface PromptDialogProps {
  open: boolean;
  title: string;
  label: string;
  initialValue: string;
  confirmLabel: string;
  help?: string;
  allowEmpty?: boolean;
  maxLength?: number;
  onSubmit: (value: string) => Promise<void>;
  onClose: () => void;
}

/** Single text field dialog (rename file, edit label, ...). */
export function PromptDialog({ open, title, label, initialValue, confirmLabel, help, allowEmpty = false, maxLength = 255, onSubmit, onClose }: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError(null);
    }
  }, [open, initialValue]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allowEmpty && !value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" dismissible={!busy}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <div>
          <label htmlFor="prompt-input" className={labelCls}>
            {label}
          </label>
          <input
            id="prompt-input"
            className={input}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={maxLength}
            data-autofocus
          />
          {help && <p className={hint}>{help}</p>}
        </div>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy || (!allowEmpty && !value.trim())}>
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
