import { useState, type ReactNode } from 'react';
import { errorMessage } from '../api/client';
import { Modal } from './Modal';
import { btnDanger, btnPrimary, btnSecondary } from './ui';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

/** Confirmation dialog that shows progress and errors from the confirm action. */
export function ConfirmDialog({ open, title, children, confirmLabel, danger = false, onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setBusy(false);
      onClose();
    } catch (e) {
      setBusy(false);
      setError(errorMessage(e));
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <button type="button" className={btnSecondary} onClick={close} disabled={busy} data-autofocus>
            Cancel
          </button>
          <button type="button" className={danger ? btnDanger : btnPrimary} onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">{children}</div>
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/60 dark:text-red-200">
          {error}
        </p>
      )}
    </Modal>
  );
}
