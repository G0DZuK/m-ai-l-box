import type { Mailbox } from '../api/types';
import type { KeyPanelReason } from '../context/UiContext';
import { downloadText } from '../lib/download';
import { formatFull } from '../lib/format';
import { CopyButton } from './CopyButton';
import { InfoBanner } from './Feedback';
import { IconDownload } from './Icons';
import { Modal } from './Modal';
import { btnPrimary, btnSecondary } from './ui';

interface KeyPanelProps {
  data: { mailbox: Mailbox; token: string; reason: KeyPanelReason } | null;
  onClose: () => void;
}

export function keyFileText(mailbox: Mailbox, token: string): string {
  const expiry = mailbox.expires_at ? `Expires: ${formatFull(mailbox.expires_at)} (${mailbox.expires_at})` : 'Expires: never (saved to an account)';
  return [
    'M-Ai-L Box mailbox access key',
    '=============================',
    '',
    `Address:    ${mailbox.address}`,
    `Access key: ${token}`,
    `Mailbox ID: ${mailbox.id}`,
    expiry,
    `Saved on:   ${new Date().toISOString()}`,
    '',
    'To return to this mailbox: open M-Ai-L Box, choose "Open existing mailbox" and paste the access key.',
    'Anyone with this key can read this mailbox. Keep it private.',
    '',
  ].join('\r\n');
}

/** One-time explanation shown after a mailbox is created or its key rotated. */
export function KeyPanelDialog({ data, onClose }: KeyPanelProps) {
  if (!data) return null;
  const { mailbox, token, reason } = data;
  const expires = mailbox.expires_at ? formatFull(mailbox.expires_at) : null;
  const title =
    reason === 'rotated'
      ? 'Your new access key'
      : reason === 'demo'
        ? 'Demo mailbox ready'
        : reason === 'view'
          ? 'Mailbox access key'
          : 'Your mailbox is ready';

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <button type="button" className={btnPrimary} onClick={onClose}>
          Got it
        </button>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">E-mail address</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-base font-semibold text-slate-900 dark:text-white">{mailbox.address}</span>
            <CopyButton text={mailbox.address} label="Copy address" ariaLabel="Copy e-mail address" />
          </div>
        </div>

        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-600 dark:text-slate-400">Access key</div>
          <div className="mt-1 break-all rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
            {token}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyButton text={token} label="Copy key" ariaLabel="Copy access key" variant="custom" className={btnSecondary} />
            <button
              type="button"
              className={btnSecondary}
              onClick={() => downloadText(`m-ai-l-box-key-${mailbox.local_part || 'mailbox'}.txt`, keyFileText(mailbox, token))}
            >
              <IconDownload className="h-4 w-4" />
              Download key (.txt)
            </button>
          </div>
        </div>

        {reason === 'rotated' && (
          <InfoBanner tone="warn">The old access key has stopped working. Any device or script using it needs this new key.</InfoBanner>
        )}

        <InfoBanner tone={mailbox.expires_at ? 'warn' : 'info'}>
          {mailbox.expires_at ? (
            <p>
              Your access key is stored only in this browser. Copy or download it to return later or from another device. Anyone with the key
              can read this mailbox. If you lose it and the mailbox is not saved to an account, it cannot be recovered and the mailbox expires
              at <strong>{expires}</strong>.
            </p>
          ) : (
            <p>
              Your access key is stored in this browser. Copy or download it to open this mailbox from another device without signing in.
              Anyone with the key can read this mailbox. This mailbox is saved to your account, so it does not expire and you can always reach it
              by signing in.
            </p>
          )}
        </InfoBanner>

        {(reason === 'demo' || mailbox.is_demo) && (
          <InfoBanner tone="warn">
            <strong>DEMO MODE</strong> — this mailbox contains sample messages generated locally. They are not real deliveries and do not prove
            that email delivery works.
          </InfoBanner>
        )}
      </div>
    </Modal>
  );
}
