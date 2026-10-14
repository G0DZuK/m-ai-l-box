import { useId, useState, type ReactNode } from 'react';
import { useConfig } from '../context/ConfigContext';
import { useMailboxes, type KnownMailbox } from '../context/MailboxContext';
import { useSession } from '../context/SessionContext';
import { useUi } from '../context/UiContext';
import type { View } from '../hooks/useHashRoute';
import { useNow } from '../hooks/useNow';
import { cx } from '../lib/cx';
import { expiryInfo } from '../lib/format';
import { ConfirmDialog } from './ConfirmDialog';
import {
  IconFolder,
  IconHelp,
  IconInbox,
  IconKey,
  IconMail,
  IconPaperclip,
  IconPlus,
  IconShield,
  IconStar,
  IconTrash,
  IconUser,
  IconX,
} from './Icons';
import { btnPrimary, btnSecondary, focusRing, iconBtnSm } from './ui';

interface SidebarProps {
  view: View;
  onNavigate: (view: View) => void;
}

export function Sidebar({ view, onNavigate }: SidebarProps) {
  const config = useConfig();
  const { signedIn, isAdmin } = useSession();
  const { active } = useMailboxes();
  const ui = useUi();
  const unread = active?.info?.unread_count ?? 0;

  const nav = (v: View, text: string, icon: ReactNode, count?: number) => (
    <li>
      <a
        href={`#/${v}`}
        onClick={(e) => {
          e.preventDefault();
          onNavigate(v);
        }}
        aria-current={view === v ? 'page' : undefined}
        className={cx(
          'flex items-center gap-3 rounded-r-full py-2 pl-4 pr-3 text-sm',
          focusRing,
          view === v
            ? 'bg-indigo-100 font-semibold text-indigo-900 dark:bg-indigo-500/20 dark:text-indigo-100'
            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
        )}
      >
        <span className="shrink-0">{icon}</span>
        <span className="flex-1">{text}</span>
        {count !== undefined && count > 0 && (
          <span className="text-xs font-semibold" aria-label={`${count} unread`}>
            {count > 999 ? '999+' : count}
          </span>
        )}
      </a>
    </li>
  );

  return (
    <nav aria-label="Main" className="flex h-full flex-col overflow-y-auto pb-4">
      <div className="space-y-2 px-3 pt-3">
        <button type="button" className={cx(btnPrimary, 'w-full justify-start rounded-2xl py-3 text-base')} onClick={ui.openCreate}>
          <IconPlus />
          Create new mailbox
        </button>
        {config.demo_mode && (
          <button type="button" className={cx(btnSecondary, 'w-full justify-start rounded-2xl')} onClick={ui.startDemo}>
            <IconMail className="h-4 w-4" />
            Try demo mailbox
          </button>
        )}
      </div>

      <ul className="mt-4 space-y-0.5 pr-3">
        {nav('inbox', 'Inbox', <IconInbox />, unread)}
        {nav('starred', 'Starred', <IconStar />)}
        {nav('attachments', 'Attachments', <IconPaperclip />)}
        {nav('trash', 'Trash', <IconTrash />)}
      </ul>

      {signedIn && (
        <ul className="mt-3 space-y-0.5 border-t border-slate-200 pr-3 pt-3 dark:border-slate-800">
          {nav('files', 'My files', <IconFolder />)}
          {nav('api-keys', 'API keys', <IconKey />)}
          {nav('account', 'Account', <IconUser />)}
          {isAdmin && nav('admin', 'Admin', <IconShield />)}
        </ul>
      )}

      <MailboxSwitcher />

      <div className="mt-auto px-3 pt-4">
        <button type="button" className={cx('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800', focusRing)} onClick={ui.openHelp}>
          <IconHelp className="h-4 w-4" />
          How mailboxes work
        </button>
      </div>
    </nav>
  );
}

function MailboxSwitcher() {
  const { mailboxes, active, setActive, removeLocal } = useMailboxes();
  const ui = useUi();
  const now = useNow(60_000);
  const [removing, setRemoving] = useState<KnownMailbox | null>(null);
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="mt-4 border-t border-slate-200 px-3 pt-3 dark:border-slate-800">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 id={headingId} className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Mailboxes
        </h2>
        <span className="text-xs text-slate-500 dark:text-slate-400">{mailboxes.length}</span>
      </div>
      {mailboxes.length === 0 ? (
        <p className="px-1 text-xs text-slate-600 dark:text-slate-400">No mailboxes in this browser yet.</p>
      ) : (
        <ul className="space-y-1">
          {mailboxes.map((m) => {
            const exp = expiryInfo(m.expires_at, now);
            const isActive = active?.id === m.id;
            const unread = m.info?.unread_count ?? 0;
            return (
              <li key={m.id} className="group relative">
                <button
                  type="button"
                  onClick={() => {
                    setActive(m.id);
                    ui.navigate('inbox');
                  }}
                  aria-current={isActive ? 'true' : undefined}
                  className={cx(
                    'w-full rounded-lg border px-2.5 py-2 pr-8 text-left',
                    focusRing,
                    isActive
                      ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-500/15'
                      : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cx('min-w-0 flex-1 truncate font-mono text-xs', m.gone ? 'text-slate-500 line-through' : 'text-slate-900 dark:text-slate-100')}>
                      {m.address}
                    </span>
                    {unread > 0 && !m.gone && (
                      <span className="rounded-full bg-indigo-600 px-1.5 text-[11px] font-bold text-white dark:bg-indigo-400 dark:text-slate-950" aria-label={`${unread} unread`}>
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-600 dark:text-slate-400">
                    {m.label && <span className="truncate font-medium text-slate-700 dark:text-slate-300">{m.label}</span>}
                    {m.gone ? (
                      <span className="font-semibold text-red-700 dark:text-red-300">Expired or removed</span>
                    ) : m.saved ? (
                      <span>Saved{m.token ? '' : ' · account only'}</span>
                    ) : (
                      <span className={exp.soon || exp.expired ? 'font-semibold text-amber-700 dark:text-amber-300' : undefined}>{exp.text}</span>
                    )}
                    {m.is_demo && <span className="font-semibold text-fuchsia-700 dark:text-fuchsia-300">Demo</span>}
                  </div>
                </button>
                {m.token && (
                  <button
                    type="button"
                    className={cx(iconBtnSm, 'absolute right-1 top-1.5', !m.gone && 'opacity-60 group-hover:opacity-100 focus-visible:opacity-100')}
                    aria-label={`Remove ${m.address} from this browser`}
                    title="Remove from this browser"
                    onClick={() => setRemoving(m)}
                  >
                    <IconX className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className={cx(btnSecondary, 'mt-2 w-full text-xs')} onClick={ui.openExisting}>
        <IconKey className="h-4 w-4" />
        Open existing mailbox
      </button>

      <ConfirmDialog
        open={!!removing}
        title={removing?.gone ? 'Remove this mailbox?' : 'Remove from this browser?'}
        confirmLabel="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          if (active?.id === removing.id) {
            const next = mailboxes.find((x) => x.id !== removing.id && !x.gone);
            if (next) setActive(next.id);
          }
          removeLocal(removing.id);
        }}
      >
        {removing?.gone ? (
          <p>
            <span className="break-all font-mono">{removing.address}</span> has expired or was deleted. Remove it from the list?
          </p>
        ) : (
          <p>
            This browser forgets the access key for <span className="break-all font-mono">{removing?.address}</span>. The mailbox itself is not
            deleted.{' '}
            {removing?.saved ? 'It stays available in your account.' : 'Make sure you have saved the key if you want to come back to it.'}
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}
