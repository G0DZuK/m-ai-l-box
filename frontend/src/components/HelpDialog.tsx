import { useConfig } from '../context/ConfigContext';
import { formatBytes } from '../lib/format';
import { Modal } from './Modal';
import { btnPrimary } from './ui';

export function HelpDialog({ open, onClose, onShortcuts }: { open: boolean; onClose: () => void; onShortcuts: () => void }) {
  const c = useConfig();
  const savedRetention =
    c.saved_message_retention_days > 0
      ? `Messages in saved mailboxes are kept for ${c.saved_message_retention_days} days.`
      : 'Messages in saved mailboxes are kept until you delete them.';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="How mailboxes work"
      size="lg"
      footer={
        <>
          <button
            type="button"
            className="mr-auto text-sm text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300"
            onClick={() => {
              onClose();
              onShortcuts();
            }}
          >
            Keyboard shortcuts
          </button>
          <button type="button" className={btnPrimary} onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="space-y-5 text-sm leading-relaxed">
        <section>
          <h3 className="mb-1 font-semibold text-slate-900 dark:text-white">Addresses and access keys</h3>
          <p>
            Each mailbox has an e-mail address and a secret <strong>access key</strong>. Knowing the address is not enough to read the mail —
            only the key (or the account it is saved to) opens it. The key is stored in this browser. To use the mailbox from another device,
            copy or download the key and use <em>Open existing mailbox</em> there. Anyone with the key can read the mailbox, so treat it like a
            password. You can replace it at any time with <em>Rotate access key</em> in the mailbox menu.
          </p>
        </section>
        <section>
          <h3 className="mb-1 font-semibold text-slate-900 dark:text-white">Expiry and retention</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Temporary mailboxes expire <strong>{c.temp_mailbox_ttl_hours} hours</strong> after they are created. When a mailbox expires, it
              and all of its messages are deleted for good.
            </li>
            <li>A temporary mailbox holds up to {c.temp_mailbox_max_messages} messages.</li>
            {c.accounts_enabled && (
              <li>
                Signed-in users can <strong>save</strong> a mailbox to their account. Saved mailboxes do not expire. {savedRetention}
              </li>
            )}
            <li>
              Messages moved to Trash are permanently deleted after <strong>{c.trash_retention_days} days</strong>.
            </li>
            <li>The largest message accepted is {formatBytes(c.max_message_bytes)}.</li>
            {c.accounts_enabled && <li>Each account has {formatBytes(c.user_quota_bytes)} of storage for saved mailboxes and personal files.</li>}
          </ul>
        </section>
        <section>
          <h3 className="mb-1 font-semibold text-slate-900 dark:text-white">What M-Ai-L Box can and cannot tell you</h3>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              M-Ai-L Box only receives mail for its own configured domain{c.domains.length === 1 ? '' : 's'}
              {c.domains.length > 0 && (
                <>
                  {' '}
                  (<span className="font-mono">{c.domains.join(', ')}</span>)
                </>
              )}
              . It cannot receive mail sent to any other address.
            </li>
            <li>
              A message arriving here shows that your system sent it and that it reached this server. It <strong>cannot</strong> tell you whether
              the same message would reach a Gmail, Outlook or other real inbox, or whether it would land in spam there.
            </li>
            <li>
              Each message shows two times: when M-Ai-L Box received it (our clock) and the sender&rsquo;s own <em>Date</em> header, which the
              sender sets and may be wrong.
            </li>
            <li>
              HTML e-mail is shown in a locked-down frame with scripts disabled. Remote images are blocked until you choose to load them, and links
              are never opened automatically.
            </li>
            {c.scanner === 'none' ? (
              <li>Attachments are not scanned for malware on this server. Only open files you expect.</li>
            ) : (
              <li>Attachments are scanned for malware. Files found to be infected cannot be downloaded.</li>
            )}
          </ul>
        </section>
        {c.demo_mode && (
          <section>
            <h3 className="mb-1 font-semibold text-slate-900 dark:text-white">Demo mode</h3>
            <p>
              The demo mailbox is filled with sample messages generated locally. They are not real deliveries and do not prove that e-mail
              delivery works.
            </p>
          </section>
        )}
        <section>
          <h3 className="mb-1 font-semibold text-slate-900 dark:text-white">For automated tests</h3>
          <p>
            Create an API key (in the mailbox menu, or under <em>API keys</em> when signed in) and call the{' '}
            <span className="font-mono">/api/mailboxes/&#123;id&#125;/wait</span> endpoint to wait up to {c.wait_max_seconds} seconds for a
            matching message. Full API docs are at{' '}
            <a className="text-indigo-700 underline dark:text-indigo-300" href="/api/docs" target="_blank" rel="noopener noreferrer">
              /api/docs
            </a>
            .
          </p>
        </section>
      </div>
    </Modal>
  );
}
