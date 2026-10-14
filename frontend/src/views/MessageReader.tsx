import { forwardRef, useCallback, useEffect, useImperativeHandle, useState, type ReactNode } from 'react';
import { ApiError, errorMessage, isAbort } from '../api/client';
import * as api from '../api/endpoints';
import type { Address, HtmlBody, MessageDetail, MessageSummary, RawSource } from '../api/types';
import { AttachmentCard, useAttachmentActions } from '../components/AttachmentCard';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { CopyButton } from '../components/CopyButton';
import { DemoBanner } from '../components/DemoBanner';
import { Badge, ErrorBanner, InfoBanner, Spinner } from '../components/Feedback';
import {
  IconArrowLeft,
  IconChevronDown,
  IconCode,
  IconDownload,
  IconExternal,
  IconHash,
  IconLink,
  IconList,
  IconMailOpen,
  IconRestore,
  IconStar,
  IconTrash,
  IconX,
} from '../components/Icons';
import { btnSecondary, btnSmall, focusRing, iconBtn } from '../components/ui';
import { useMailboxes } from '../context/MailboxContext';
import { useToast } from '../context/ToastContext';
import { cx } from '../lib/cx';
import { triggerDownload } from '../lib/download';
import { describeDateDelta, formatBytes, formatFull } from '../lib/format';

type BodyTab = 'html' | 'text' | 'headers' | 'source';

export interface ReaderHandle {
  toggleStar: () => void;
  markRead: (read: boolean) => void;
  trash: () => void;
}

interface ReaderProps {
  mailboxId: string;
  messageId: string;
  onBack: () => void;
  /** Called whenever the message's flags change, so the list can update. */
  onUpdated: (summary: MessageSummary) => void;
  /** Called after the message was moved to Trash, restored or deleted (it left the current folder). */
  onRemoved: (id: string) => void;
}

export const MessageReader = forwardRef<ReaderHandle, ReaderProps>(function MessageReader(
  { mailboxId, messageId, onBack, onUpdated, onRemoved },
  ref,
) {
  const { adjustUnread } = useMailboxes();
  const { toast } = useToast();
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<BodyTab>('text');
  const [html, setHtml] = useState<{ body: HtmlBody; remote: boolean } | null>(null);
  const [htmlAttempt, setHtmlAttempt] = useState(0);
  const [htmlError, setHtmlError] = useState<string | null>(null);
  const [remoteImages, setRemoteImages] = useState(false);
  const [raw, setRaw] = useState<RawSource | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const attachmentActions = useAttachmentActions(mailboxId);

  // Load the message; mark it read on open.
  useEffect(() => {
    const ctrl = new AbortController();
    setDetail(null);
    setError(null);
    setHtml(null);
    setHtmlError(null);
    setRaw(null);
    setRawError(null);
    setRemoteImages(false);
    api
      .getMessage(mailboxId, messageId, ctrl.signal)
      .then((d) => {
        setDetail(d);
        setTab(d.has_html ? 'html' : 'text');
        if (!d.is_read) {
          api
            .patchMessage(mailboxId, messageId, { is_read: true })
            .then((s) => {
              setDetail((cur) => (cur && cur.id === s.id ? { ...cur, is_read: s.is_read } : cur));
              onUpdated(s);
              adjustUnread(mailboxId, -1);
            })
            .catch(() => undefined);
        }
      })
      .catch((e) => {
        if (isAbort(e)) return;
        if (e instanceof ApiError && e.status === 404) setError('This message no longer exists. It may have been deleted or the mailbox expired.');
        else setError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [mailboxId, messageId, attempt]);

  // Load the sanitised HTML body when needed.
  useEffect(() => {
    if (!detail || !detail.has_html || tab !== 'html') return;
    if (html && html.remote === remoteImages) return;
    const ctrl = new AbortController();
    setHtmlError(null);
    api
      .getMessageHtml(mailboxId, detail.id, remoteImages, ctrl.signal)
      .then((body) => setHtml({ body, remote: remoteImages }))
      .catch((e) => {
        if (!isAbort(e)) setHtmlError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [detail, tab, remoteImages, mailboxId, html, htmlAttempt]);

  // Load the raw source lazily.
  useEffect(() => {
    if (!detail || tab !== 'source' || raw) return;
    const ctrl = new AbortController();
    setRawError(null);
    api
      .getMessageRaw(mailboxId, detail.id, ctrl.signal)
      .then(setRaw)
      .catch((e) => {
        if (!isAbort(e)) setRawError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [detail, tab, raw, mailboxId]);

  const patch = useCallback(
    async (body: { is_read?: boolean; is_starred?: boolean }) => {
      if (!detail) return;
      try {
        const s = await api.patchMessage(mailboxId, detail.id, body);
        if (body.is_read !== undefined && body.is_read !== detail.is_read) adjustUnread(mailboxId, body.is_read ? -1 : 1);
        setDetail((cur) => (cur ? { ...cur, ...s } : cur));
        onUpdated(s);
      } catch (e) {
        toast(errorMessage(e), 'error');
      }
    },
    [detail, mailboxId, onUpdated, adjustUnread, toast],
  );

  const toggleStar = useCallback(() => {
    if (detail) void patch({ is_starred: !detail.is_starred });
  }, [detail, patch]);

  const markRead = useCallback(
    (read: boolean) => {
      if (!detail) return;
      void patch({ is_read: read }).then(() => {
        if (!read) onBack();
      });
    },
    [detail, patch, onBack],
  );

  const trash = useCallback(async () => {
    if (!detail) return;
    try {
      if (detail.in_trash) {
        const s = await api.restoreMessage(mailboxId, detail.id);
        onUpdated(s);
        toast('Message restored.', 'success');
      } else {
        const s = await api.trashMessage(mailboxId, detail.id);
        onUpdated(s);
        if (!detail.is_read) adjustUnread(mailboxId, -1);
        toast('Moved to Trash.', 'success');
      }
      onRemoved(detail.id);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }, [detail, mailboxId, onUpdated, onRemoved, adjustUnread, toast]);

  useImperativeHandle(ref, () => ({ toggleStar, markRead, trash: () => void trash() }), [toggleStar, markRead, trash]);

  const downloadEml = async () => {
    if (!detail) return;
    try {
      const link = await api.getMessageDownloadLink(mailboxId, detail.id);
      const safe = (detail.subject || 'message').replace(/[^\w.-]+/g, '_').slice(0, 60);
      triggerDownload(link.url, `${safe}.eml`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  if (error) {
    return (
      <div className="p-4">
        <button type="button" className={cx(btnSecondary, 'mb-4')} onClick={onBack}>
          <IconArrowLeft className="h-4 w-4" />
          Back to list
        </button>
        <ErrorBanner message={error} onRetry={() => setAttempt((n) => n + 1)} />
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-4 p-6" aria-busy="true">
        <span className="sr-only">Loading message</span>
        <div className="h-7 w-2/3 rounded bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800" />
        <div className="h-4 w-1/3 rounded bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800" />
        <div className="h-4 w-1/2 rounded bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800" />
        <div className="h-64 rounded bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800/60" />
      </div>
    );
  }

  const delta = describeDateDelta(detail.received_at, detail.sent_at);
  const visibleAttachments = detail.attachments;

  const tabs: Array<{ id: BodyTab; label: string; icon: ReactNode; show: boolean }> = [
    { id: 'html', label: 'HTML', icon: <IconCode className="h-4 w-4" />, show: detail.has_html },
    { id: 'text', label: 'Plain text', icon: <IconList className="h-4 w-4" />, show: true },
    { id: 'headers', label: 'Headers', icon: <IconHash className="h-4 w-4" />, show: true },
    { id: 'source', label: 'Source', icon: <IconCode className="h-4 w-4" />, show: true },
  ];

  return (
    <article className="flex min-h-full flex-col" aria-labelledby="reader-subject">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white/95 px-2 py-1.5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <button type="button" className={iconBtn} onClick={onBack} aria-label="Back to list (u)" title="Back to list (u)">
          <IconArrowLeft />
        </button>
        <span className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
        <button
          type="button"
          className={iconBtn}
          onClick={toggleStar}
          aria-pressed={detail.is_starred}
          aria-label={detail.is_starred ? 'Unstar (s)' : 'Star (s)'}
          title={detail.is_starred ? 'Unstar (s)' : 'Star (s)'}
        >
          <IconStar filled={detail.is_starred} className={cx('h-5 w-5', detail.is_starred && 'text-amber-500')} />
        </button>
        <button type="button" className={iconBtn} onClick={() => markRead(false)} aria-label="Mark as unread (Shift+U)" title="Mark as unread (Shift+U)">
          <IconMailOpen />
        </button>
        <button
          type="button"
          className={iconBtn}
          onClick={() => void trash()}
          aria-label={detail.in_trash ? 'Restore from Trash' : 'Move to Trash (#)'}
          title={detail.in_trash ? 'Restore from Trash' : 'Move to Trash (#)'}
        >
          {detail.in_trash ? <IconRestore /> : <IconTrash />}
        </button>
        <button type="button" className={iconBtn} onClick={() => setConfirmDelete(true)} aria-label="Delete forever" title="Delete forever">
          <IconX />
        </button>
        <span className="mx-1 h-6 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
        <button type="button" className={cx(btnSmall, 'mr-1')} onClick={() => void downloadEml()}>
          <IconDownload className="h-3.5 w-3.5" />
          .eml
        </button>
        <button type="button" className={cx(btnSmall, 'mr-1 hidden sm:inline-flex')} onClick={() => setTab('source')}>
          View source
        </button>
        <button type="button" className={cx(btnSmall, 'hidden sm:inline-flex')} onClick={() => setTab('headers')}>
          View headers
        </button>
      </div>

      {detail.is_demo && <DemoBanner />}

      <div className="space-y-5 px-4 py-4 sm:px-6">
        {/* Subject + participants */}
        <header className="space-y-3">
          <div className="flex flex-wrap items-start gap-2">
            <h1 id="reader-subject" className="min-w-0 flex-1 break-words text-xl font-semibold text-slate-900 dark:text-white">
              {detail.subject || '(no subject)'}
            </h1>
            {detail.is_demo && <Badge tone="purple">Sample</Badge>}
            {detail.in_trash && <Badge tone="neutral">In Trash</Badge>}
          </div>
          <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-600 dark:text-slate-400">From</dt>
            <dd className="min-w-0">
              <AddressView a={detail.from} />
            </dd>
            <dt className="text-slate-600 dark:text-slate-400">To</dt>
            <dd className="min-w-0">
              <AddressList list={detail.to} />
            </dd>
            {detail.cc.length > 0 && (
              <>
                <dt className="text-slate-600 dark:text-slate-400">Cc</dt>
                <dd className="min-w-0">
                  <AddressList list={detail.cc} />
                </dd>
              </>
            )}
            {detail.reply_to.length > 0 && (
              <>
                <dt className="text-slate-600 dark:text-slate-400">Reply-To</dt>
                <dd className="min-w-0">
                  <AddressList list={detail.reply_to} />
                </dd>
              </>
            )}
          </dl>

          {/* Two clearly distinguished times */}
          <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-800/50 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Received by M-Ai-L Box</div>
              <div className="font-mono text-slate-900 dark:text-slate-100">{formatFull(detail.received_at)}</div>
              <div className="text-xs text-slate-600 dark:text-slate-400">Our server clock — reliable.</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Sender&rsquo;s Date header</div>
              <div className="font-mono text-slate-900 dark:text-slate-100">{detail.sent_at ? formatFull(detail.sent_at) : 'Not provided'}</div>
              <div className="text-xs text-slate-600 dark:text-slate-400">Set by the sender, may be inaccurate.</div>
            </div>
            {delta && <div className="text-xs text-slate-700 dark:text-slate-300 sm:col-span-2">{delta}</div>}
          </div>
        </header>

        <QaPanel detail={detail} />

        {visibleAttachments.length > 0 && (
          <section aria-labelledby="att-heading">
            <h2 id="att-heading" className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">
              Attachments ({visibleAttachments.length})
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visibleAttachments.map((a) => (
                <AttachmentCard key={a.id} att={a} actions={attachmentActions} />
              ))}
            </ul>
          </section>
        )}

        {/* Body */}
        <section aria-label="Message body">
          <div role="tablist" aria-label="Message view" className="mb-3 inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {tabs
              .filter((t) => t.show)
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  id={`tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls="message-tabpanel"
                  onClick={() => setTab(t.id)}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium',
                    focusRing,
                    tab === t.id
                      ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white',
                  )}
                >
                  {t.icon}
                  {t.label}
                </button>
              ))}
          </div>

          <div id="message-tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === 'html' && (
              <HtmlBodyView
                html={html && html.remote === remoteImages ? html.body : null}
                error={htmlError}
                onLoadRemote={() => setRemoteImages(true)}
                onRetry={() => {
                  setHtml(null);
                  setHtmlError(null);
                  setHtmlAttempt((n) => n + 1);
                }}
              />
            )}
            {tab === 'text' &&
              (detail.text_body ? (
                <pre className="whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white p-4 font-mono text-[13px] leading-relaxed text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                  {detail.text_body}
                </pre>
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-400">This message has no plain-text content.</p>
              ))}
            {tab === 'headers' && <HeadersView detail={detail} />}
            {tab === 'source' && <SourceView raw={raw} error={rawError} onRetry={() => setRaw(null)} onDownload={() => void downloadEml()} />}
          </div>
        </section>

        <TechnicalDetails detail={detail} />
      </div>

      {attachmentActions.previewModal}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this message forever?"
        confirmLabel="Delete forever"
        danger
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await api.deleteMessage(mailboxId, detail.id);
          if (!detail.is_read && !detail.in_trash) adjustUnread(mailboxId, -1);
          toast('Message deleted.', 'success');
          onRemoved(detail.id);
        }}
      >
        <p>The message, its attachments and its original source will be permanently deleted. This cannot be undone.</p>
      </ConfirmDialog>
    </article>
  );
});

function AddressView({ a }: { a: Address | null }) {
  if (!a) return <span className="text-slate-500">(unknown sender)</span>;
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5">
      {a.name && <span className="font-semibold text-slate-900 dark:text-white">{a.name}</span>}
      <span className={cx('break-all font-mono text-xs', a.name ? 'text-slate-600 dark:text-slate-400' : 'text-slate-900 dark:text-slate-100')}>
        {a.name ? `<${a.address}>` : a.address}
      </span>
      <CopyButton text={a.address} variant="icon" ariaLabel={`Copy address ${a.address}`} />
    </span>
  );
}

function AddressList({ list }: { list: Address[] }) {
  if (list.length === 0) return <span className="text-slate-500">—</span>;
  return (
    <ul className="space-y-0.5">
      {list.map((a, i) => (
        <li key={`${a.address}-${i}`}>
          <AddressView a={a} />
        </li>
      ))}
    </ul>
  );
}

function QaPanel({ detail }: { detail: MessageDetail }) {
  const codes = detail.otp_codes;
  const links = detail.links;
  const empty = codes.length === 0 && links.length === 0;
  return (
    <details open={!empty} className="group rounded-xl border border-slate-200 dark:border-slate-700">
      <summary className={cx('flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold', focusRing)}>
        <IconChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        Testing helpers
        <span className="font-normal text-slate-600 dark:text-slate-400">
          {empty ? '— no codes or links found' : `— ${codes.length} code${codes.length === 1 ? '' : 's'}, ${links.length} link${links.length === 1 ? '' : 's'}`}
        </span>
      </summary>
      {!empty && (
        <div className="space-y-4 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          {codes.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Codes found</h3>
              <ul className="flex flex-wrap gap-3">
                {codes.map((c, i) => (
                  <li key={`${c.code}-${i}`} className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-800 dark:bg-indigo-950/50">
                    <div className="flex items-center gap-3">
                      <span className="select-all font-mono text-2xl font-bold tracking-[0.2em] text-indigo-950 dark:text-indigo-100">{c.code}</span>
                      <CopyButton text={c.code} label="Copy" ariaLabel={`Copy code ${c.code}`} />
                    </div>
                    {c.context && <p className="mt-1 max-w-xs truncate text-xs text-slate-600 dark:text-slate-400" title={c.context}>{c.context}</p>}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">Detected automatically. The original message is unchanged.</p>
            </div>
          )}
          {links.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Links in this message</h3>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                {links.map((l, i) => (
                  <li key={`${l.url}-${i}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <IconLink className="h-4 w-4 shrink-0 text-slate-500" />
                    <div className="min-w-0 flex-1">
                      {l.text && <div className="truncate font-medium text-slate-900 dark:text-white">{l.text}</div>}
                      <div className="break-all font-mono text-xs text-slate-600 dark:text-slate-400">{l.url}</div>
                    </div>
                    <CopyButton text={l.url} label="Copy" ariaLabel={`Copy link ${l.url}`} />
                    <a className={btnSmall} href={l.url} target="_blank" rel="noopener noreferrer nofollow" aria-label={`Open link in a new tab: ${l.url}`}>
                      <IconExternal className="h-3.5 w-3.5" />
                      Open
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">Links are never opened automatically. &ldquo;Open&rdquo; uses a new tab without sharing where you came from.</p>
            </div>
          )}
        </div>
      )}
    </details>
  );
}

function HtmlBodyView({ html, error, onLoadRemote, onRetry }: { html: HtmlBody | null; error: string | null; onLoadRemote: () => void; onRetry: () => void }) {
  if (error) return <ErrorBanner message={error} onRetry={onRetry} />;
  if (!html) {
    return (
      <div className="flex h-40 items-center justify-center text-slate-500">
        <Spinner className="h-5 w-5" label="Loading message" />
      </div>
    );
  }
  if (html.html === null) return <p className="text-sm text-slate-600 dark:text-slate-400">This message has no HTML version.</p>;
  return (
    <div className="space-y-2">
      {html.blocked_remote_images > 0 && !html.remote_images_loaded && (
        <InfoBanner tone="warn">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex-1">
              {html.blocked_remote_images} remote image{html.blocked_remote_images === 1 ? ' was' : 's were'} blocked to protect your privacy.
            </span>
            <button type="button" className={btnSmall} onClick={onLoadRemote}>
              Load remote images
            </button>
          </div>
        </InfoBanner>
      )}
      {/* Rendered ONLY inside a sandboxed iframe: no scripts, no same-origin access. */}
      <div className="h-[70vh] min-h-[60vh] resize-y overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700">
        <iframe
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={html.html}
          referrerPolicy="no-referrer"
          title="Message content"
          className="h-full w-full border-0 bg-white"
        />
      </div>
      <p className="text-xs text-slate-600 dark:text-slate-400">Drag the bottom-right corner to resize. Scripts in e-mails are always disabled.</p>
    </div>
  );
}

function HeadersView({ detail }: { detail: MessageDetail }) {
  const all = detail.headers.map((h) => `${h.name}: ${h.value}`).join('\n');
  if (detail.headers.length === 0) return <p className="text-sm text-slate-600 dark:text-slate-400">No headers available.</p>;
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <CopyButton text={all} label="Copy all headers" ariaLabel="Copy all headers" />
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold">Name</th>
              <th scope="col" className="px-3 py-2 font-semibold">Value</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {detail.headers.map((h, i) => (
              <tr key={`${h.name}-${i}`} className="border-t border-slate-100 align-top dark:border-slate-800">
                <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-slate-800 dark:text-slate-200">{h.name}</td>
                <td className="break-all px-3 py-1.5 text-slate-700 dark:text-slate-300">{h.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SourceView({ raw, error, onRetry, onDownload }: { raw: RawSource | null; error: string | null; onRetry: () => void; onDownload: () => void }) {
  if (error) return <ErrorBanner message={error} onRetry={onRetry} />;
  if (!raw) {
    return (
      <div className="flex h-40 items-center justify-center text-slate-500">
        <Spinner className="h-5 w-5" label="Loading source" />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-600 dark:text-slate-400">Original size {formatBytes(raw.size_bytes)}</span>
        <span className="flex-1" />
        <CopyButton text={raw.raw} label="Copy source" ariaLabel="Copy message source" />
        <button type="button" className={btnSmall} onClick={onDownload}>
          <IconDownload className="h-3.5 w-3.5" />
          Download .eml
        </button>
      </div>
      {raw.truncated && <InfoBanner tone="warn">Only the first part of this large message is shown. Download the .eml file for the full source.</InfoBanner>}
      <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
        {raw.raw}
      </pre>
    </div>
  );
}

function TechnicalDetails({ detail }: { detail: MessageDetail }) {
  const rows: Array<[string, string]> = [
    ['Envelope from', detail.envelope_from ?? '—'],
    ['Envelope to', detail.envelope_to.join(', ') || '—'],
    ['Message-ID', detail.message_id_header ?? '—'],
    ['Delivered via', detail.delivery_source],
    ['Size', formatBytes(detail.size_bytes)],
    ['Internal ID', detail.id],
  ];
  return (
    <details className="group rounded-xl border border-slate-200 text-sm dark:border-slate-700">
      <summary className={cx('flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2.5 font-semibold', focusRing)}>
        <IconChevronDown className="h-4 w-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        Technical details
      </summary>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 border-t border-slate-200 px-4 py-3 dark:border-slate-700 sm:grid-cols-[auto,1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-600 dark:text-slate-400">{k}</dt>
            <dd className="break-all font-mono text-xs leading-5">{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
