import { useState } from 'react';
import * as api from '../api/endpoints';
import { toMailbox, useMailboxes, type KnownMailbox } from '../context/MailboxContext';
import { useSession } from '../context/SessionContext';
import { useToast } from '../context/ToastContext';
import { useUi } from '../context/UiContext';
import { errorMessage } from '../api/client';
import { ConfirmDialog } from './ConfirmDialog';
import { IconBookmark, IconKey, IconPencil, IconRefresh, IconSettings, IconTrash, IconX, IconCode } from './Icons';
import { MailboxApiKeysDialog } from './MailboxApiKeysDialog';
import { Menu, type MenuItem } from './Menu';
import { PromptDialog } from './PromptDialog';
import { iconBtn } from './ui';

type Dialog = 'label' | 'rotate' | 'delete' | 'remove' | 'keys' | 'release' | null;

/** Per-mailbox actions: label, save to account, API keys, rotate key, remove, delete. */
export function MailboxSettingsMenu({ mailbox }: { mailbox: KnownMailbox }) {
  const { signedIn } = useSession();
  const { updateInfo, replaceToken, removeLocal, refreshSaved, mailboxes, setActive } = useMailboxes();
  const { toast } = useToast();
  const ui = useUi();
  const [dialog, setDialog] = useState<Dialog>(null);

  const switchAway = () => {
    const next = mailboxes.find((m) => m.id !== mailbox.id && !m.gone);
    if (next) setActive(next.id);
  };

  const claim = async () => {
    try {
      const m = await api.claimMailbox(mailbox.id);
      updateInfo(m);
      await refreshSaved();
      toast('Saved to your account. This mailbox no longer expires.', 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const items: Array<MenuItem | 'separator'> = [];
  if (!mailbox.gone) {
    items.push({ label: 'Edit label', icon: <IconPencil className="h-4 w-4" />, onSelect: () => setDialog('label') });
    if (signedIn && !mailbox.saved && mailbox.token && !mailbox.is_demo) {
      items.push({
        label: 'Save to my account',
        hint: 'Stops it from expiring',
        icon: <IconBookmark className="h-4 w-4" />,
        onSelect: () => void claim(),
      });
    }
    if (signedIn && mailbox.saved) {
      items.push({
        label: 'Remove from my account',
        hint: 'It becomes temporary again',
        icon: <IconBookmark className="h-4 w-4" />,
        onSelect: () => setDialog('release'),
      });
    }
    items.push({ label: 'API keys for this mailbox', icon: <IconCode className="h-4 w-4" />, onSelect: () => setDialog('keys') });
    if (mailbox.token) {
      const token = mailbox.token;
      items.push({
        label: 'Show / download access key',
        icon: <IconKey className="h-4 w-4" />,
        onSelect: () => ui.showKey(toMailbox(mailbox), token, 'view'),
      });
    }
    items.push({ label: 'Rotate access key', hint: 'The old key stops working', icon: <IconRefresh className="h-4 w-4" />, onSelect: () => setDialog('rotate') });
    items.push('separator');
  }
  if (mailbox.token) {
    items.push({ label: 'Remove from this browser', icon: <IconX className="h-4 w-4" />, onSelect: () => setDialog('remove') });
  }
  if (!mailbox.gone) {
    items.push({ label: 'Delete mailbox', danger: true, icon: <IconTrash className="h-4 w-4" />, onSelect: () => setDialog('delete') });
  }

  return (
    <>
      <Menu
        trigger={<IconSettings className="h-5 w-5" />}
        triggerLabel="Mailbox settings"
        triggerClassName={iconBtn}
        items={items}
        header={<div className="truncate text-xs text-slate-600 dark:text-slate-400">{mailbox.address}</div>}
      />

      <PromptDialog
        open={dialog === 'label'}
        title="Edit label"
        label="Label"
        help="Only you see the label. Leave it empty to remove it."
        initialValue={mailbox.label ?? ''}
        confirmLabel="Save"
        allowEmpty
        maxLength={80}
        onClose={() => setDialog(null)}
        onSubmit={async (value) => {
          const m = await api.updateMailbox(mailbox.id, value || null);
          updateInfo(m);
        }}
      />

      <ConfirmDialog
        open={dialog === 'rotate'}
        title="Rotate access key?"
        confirmLabel="Rotate key"
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          const res = await api.rotateMailboxToken(mailbox.id);
          replaceToken(res.mailbox, res.token);
          ui.showKey(res.mailbox, res.token, 'rotated');
        }}
      >
        <p>A new access key will be created and the current one will stop working immediately — on every device and in every script that uses it.</p>
        <p>This browser switches to the new key automatically.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'release'}
        title="Remove from your account?"
        confirmLabel="Remove from account"
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          const m = await api.releaseMailbox(mailbox.id);
          updateInfo(m);
          await refreshSaved();
          toast('Removed from your account. The mailbox is temporary again.', 'success');
        }}
      >
        <p>The mailbox becomes temporary again and its expiry timer restarts. Messages are kept until it expires.</p>
        {!mailbox.token && (
          <p className="font-medium text-amber-800 dark:text-amber-300">
            This browser has no access key for it, so you will lose access unless you rotate the key first and save it.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'remove'}
        title="Remove from this browser?"
        confirmLabel="Remove"
        onClose={() => setDialog(null)}
        onConfirm={() => {
          switchAway();
          removeLocal(mailbox.id);
          toast(`Removed ${mailbox.address} from this browser.`);
        }}
      >
        <p>
          The mailbox itself is not deleted, but this browser forgets its access key.
          {mailbox.saved ? ' It stays available in your account.' : ' Make sure you have copied or downloaded the key if you want to come back.'}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'delete'}
        title="Delete this mailbox?"
        confirmLabel="Delete forever"
        danger
        onClose={() => setDialog(null)}
        onConfirm={async () => {
          await api.deleteMailbox(mailbox.id);
          switchAway();
          removeLocal(mailbox.id);
          await refreshSaved();
          toast(`Deleted ${mailbox.address}.`, 'success');
        }}
      >
        <p>
          <strong className="break-all">{mailbox.address}</strong> and all of its messages and attachments will be permanently deleted. This
          cannot be undone.
        </p>
      </ConfirmDialog>

      {dialog === 'keys' && <MailboxApiKeysDialog mailbox={mailbox} onClose={() => setDialog(null)} />}
    </>
  );
}
