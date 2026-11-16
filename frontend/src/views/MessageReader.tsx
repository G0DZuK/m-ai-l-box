import { forwardRef, useCallback, useEffect, useImperativeHandle, useState, type ReactNode } from 'react';
import { ApiError, errorMessage, isAbort } from '../api/client';
import * as api from '../api/endpoints';
import type { HtmlBody, MessageDetail, MessageSummary, RawSource } from '../api/types';
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
import { formatBytes, formatFull } from '../lib/format';

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
  onUpdated: (summary: MessageSummary) => void;
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
  const [showDetails, setShowDetails] = useState(false);
  const attachmentActions = useAttachmentActions(mailboxId);

  useEffect(() => {
    const ctrl = new AbortController();
    setDetail(null);
    setError(null);
    setHtml(null);
    setHtmlError(null);
    setRaw(null);
    setRawError(null);
    setRemoteImages(false);
    setShowDetails(false);
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
        if (e instanceof ApiError && e.status === 404)
          setError('This message no longer exists. It may have been deleted or the mailbox expired.');
        else setError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [mailboxId, messageId, attempt]);

  useEffect(() => {
    if (!detail || !detail.has_html || tab !== 'html') return;
    if (html && html.remote === remoteImages) return;
    const ctrl = new AbortController();
    setHtmlError(null);
    api
      .getMessageHtml(mailboxId, detail.id, remoteImages, ctrl.signal)
      .then((body) => setHtml({ body, remote: remoteImages }))
      .catch((e) => { if (!isAbort(e)) setHtmlError(errorMessage(e)); });
    return () => ctrl.abort();
  }, [detail, tab, remoteImages, mailboxId, html, htmlAttempt]);

  useEffect(() => {
    if (!detail || tab !== 'source' || raw) return;
    const ctrl = new AbortController();
    setRawError(null);
    api
      .getMessageRaw(mailboxId, detail.id, ctrl.signal)
      .then(setRaw)
      .catch((e) => { if (!isAbort(e)) setRawError(errorMessage(e)); });
    return () => ctrl.abort();
  }, [detail, tab, raw, mailboxId]);

  const patch = useCallback(
    async (body: { is_read?: boolean; is_starred?: boolean }) => {
      if (!detail) return;
      try {
        const s = await api.patchMessage(mailboxId, detail.id, body);
        if (body.is_read !== undefined && body.is_read !== detail.is_read)
          adjustUnread(mailboxId, body.is_read ? -1 : 1);
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
      void patch({ is_read: read }).then(() => { if (!read) onBack(); });
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
        <div className="h-7 w-2/3 rounded bg-[#e8eaed] motion-safe:animate-pulse dark:bg-[#3c4043]" />
        <div className="h-4 w-1/3 rounded bg-[#e8eaed] motion-safe:animate-pulse dark:bg-[#3c4043]" />
        <div className="h-4 w-1/2 rounded bg-[#e8eaed] motion-safe:animate-pulse dark:bg-[#3c4043]" />
        <div className="h-64 rounded bg-[#f1f3f4] motion-safe:animate-pulse dark:bg-[#3c4043]" />
      </div>
    );
  }

  const visibleAttachments = detail.attachments;
  const hasCodes = detail.otp_codes.length > 0;
  const hasLinks = detail.links.length > 0;

  const tabs: Array<{ id: BodyTab; label: string; icon: ReactNode; show: boolean }> = [
    { id: 'html', label: 'HTML', icon: <IconCode className="h-4 w-4" />, show: detail.has_html },
    { id: 'text', label: 'Plain text', icon: <IconList className="h-4 w-4" />, show: true },
    { id: 'headers', label: 'Headers', icon: <IconHash className="h-4 w-4" />, show: true },
    { id: 'source', label: 'Source', icon: <IconCode className="h-4 w-4" />, show: true },
  ];

  return (
    <article className="flex min-h-full flex-col bg-white dark:bg-[#2d2e30]" aria-labelledby="reader-subject">
      {/* ── Toolbar ── */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-[#e0e0e0] bg-white/95 px-2 py-1 backdrop-blur dark:border-[#3c4043] dark:bg-[#2d2e30]/95">
        <button type="button" className={iconBtn} onClick={onBack} aria-label="Back to list (u)" title="Back to list (u)">
          <IconArrowLeft />
        </button>
        <span className="mx-1 h-5 w-px bg-[#e0e0e0] dark:bg-[#5f6368]" aria-hidden="true" />
        <button
          type="button"
          className={iconBtn}
          onClick={toggleStar}
          aria-pressed={detail.is_starred}
          aria-label={detail.is_starred ? 'Unstar' : 'Star'}
          title={detail.is_starred ? 'Unstar' : 'Star'}
        >
          <IconStar filled={detail.is_starred} className={cx('h-5 w-5', detail.is_starred && 'text-[#f9ab00]')} />
        </button>
        <button type="button" className={iconBtn} onClick={() => markRead(false)} aria-label="Mark as unread" title="Mark as unread">
          <IconMailOpen />
        </button>
        <button
          type="button"
          className={iconBtn}
          onClick={() => void trash()}
          aria-label={detail.in_trash ? 'Restore from Trash' : 'Move to Trash'}
          title={detail.in_trash ? 'Restore from Trash' : 'Move to Trash'}
        >
          {detail.in_trash ? <IconRestore /> : <IconTrash />}
        </button>
        <button type="button" className={iconBtn} onClick={() => setConfirmDelete(true)} aria-label="Delete forever" title="Delete forever">
          <IconX />
        </button>
        <span className="mx-1 h-5 w-px bg-[#e0e0e0] dark:bg-[#5f6368]" aria-hidden="true" />
        {/* Developer tools — small, tucked away */}
        <button type="button" className={cx(btnSmall, 'text-xs text-[#5f6368]')} onClick={() => void downloadEml()}>
          <IconDownload className="h-3.5 w-3.5" />
          .eml
        </button>
        <button type="button" className={cx(btnSmall, 'hidden text-xs text-[#5f6368] sm:inline-flex')} onClick={() => setTab('source')}>
          Source
        </button>
        <button type="button" className={cx(btnSmall, 'hidden text-xs text-[#5f6368] sm:inline-flex')} onClick={() => setTab('headers')}>
          Headers
        </button>
      </div>

      {detail.is_demo && <DemoBanner />}

      <div className="flex-1 px-6 py-5 sm:px-10">
        {/* ── Subject ── */}
        <div className="flex flex-wrap items-start gap-2 pb-3">
          <h1
            id="reader-subject"
            className="min-w-0 flex-1 break-words text-2xl font-normal text-[#202124] dark:text-[#e3e3e3]"
            style={{ fontFamily: "'Google Sans', sans-serif" }}
          >
            {detail.subject || '(no subject)'}
          </h1>
          {detail.is_demo && <Badge tone="purple">Sample</Badge>}
          {detail.in_trash && <Badge tone="neutral">In Trash</Badge>}
        </div>

        {/* ── Sender row — Gmail style ── */}
        <div className="mb-4 flex items-start gap-3 border-b border-[#e0e0e0] pb-4 dark:border-[#3c4043]">
          {/* Avatar circle */}
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1A73E8] text-sm font-bold text-white dark:bg-[#004A77] dark:text-[#C2E7FF]"
            aria-hidden="true"
          >
            {(detail.from?.name || detail.from?.address || '?').charAt(0).toUpperCase()}
          </div>

          <div className="min-w-0 flex-1">
            {/* From line */}
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-[#202124] dark:text-[#e3e3e3]">
                {detail.from?.name || detail.from?.address || '(unknown sender)'}
              </span>
              {detail.from?.name && (
                <span className="text-xs text-[#5f6368] dark:text-[#9aa0a6]">
                  &lt;{detail.from.address}&gt;
                </span>
              )}
              <CopyButton text={detail.from?.address ?? ''} variant="icon" ariaLabel="Copy sender address" />
            </div>

            {/* To line */}
            <div className="mt-0.5 flex items-center gap-1 text-xs text-[#5f6368] dark:text-[#9aa0a6]">
              <span>to</span>
              {detail.to.map((a, i) => (
                <span key={`${a.address}-${i}`}>{a.name || a.address}</span>
              ))}
              {detail.cc.length > 0 && (
                <span>, cc: {detail.cc.map((a) => a.name || a.address).join(', ')}</span>
              )}
              {/* Expandable details link */}
              <button
                type="button"
                className={cx('ml-1 inline-flex items-center gap-0.5 rounded text-[#5f6368] hover:text-[#202124] dark:hover:text-[#e3e3e3]', focusRing)}
                onClick={() => setShowDetails((v) => !v)}
                aria-expanded={showDetails}
              >
                <IconChevronDown className={cx('h-3.5 w-3.5 transition-transform', showDetails && 'rotate-180')} />
              </button>
            </div>

            {/* Expanded detail panel — hidden by default */}
            {showDetails && (
              <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 rounded-xl border border-[#e0e0e0] bg-[#f6f8fc] p-3 text-xs dark:border-[#3c4043] dark:bg-[#1f1f1f]">
                {detail.from && (
                  <>
                    <dt className="text-[#5f6368]">From</dt>
                    <dd className="break-all font-mono">{detail.from.name ? `${detail.from.name} <${detail.from.address}>` : detail.from.address}</dd>
                  </>
                )}
                <dt className="text-[#5f6368]">To</dt>
                <dd className="break-all font-mono">{detail.to.map((a) => a.name ? `${a.name} <${a.address}>` : a.address).join(', ') || '—'}</dd>
                {detail.cc.length > 0 && (
                  <>
                    <dt className="text-[#5f6368]">Cc</dt>
                    <dd className="break-all font-mono">{detail.cc.map((a) => a.address).join(', ')}</dd>
                  </>
                )}
                {detail.reply_to.length > 0 && (
                  <>
                    <dt className="text-[#5f6368]">Reply-To</dt>
                    <dd className="break-all font-mono">{detail.reply_to.map((a) => a.address).join(', ')}</dd>
                  </>
                )}
                <dt className="text-[#5f6368]">Date</dt>
                <dd className="font-mono">{formatFull(detail.received_at)}</dd>
                {detail.message_id_header && (
                  <>
                    <dt className="text-[#5f6368]">Message-ID</dt>
                    <dd className="break-all font-mono">{detail.message_id_header}</dd>
                  </>
                )}
                <dt className="text-[#5f6368]">Size</dt>
                <dd>{formatBytes(detail.size_bytes)}</dd>
                <dt className="text-[#5f6368]">Delivered via</dt>
                <dd>{detail.delivery_source}</dd>
              </dl>
            )}
          </div>

          {/* Timestamp top-right */}
          <time
            dateTime={detail.received_at}
            title={`Received ${formatFull(detail.received_at)}`}
            className="shrink-0 text-xs text-[#5f6368] dark:text-[#9aa0a6]"
          >
            {formatFull(detail.received_at)}
          </time>
        </div>

        {/* ── OTP Codes — inline pill, no section heading ── */}
        {hasCodes && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {detail.otp_codes.map((c, i) => (
              <div
                key={`${c.code}-${i}`}
                className="flex items-center gap-2 rounded-2xl border border-[#D3E3FD] bg-[#EAF1FB] px-4 py-2 dark:border-[#1a3a5c] dark:bg-[#1a3a5c]"
              >
                <span className="select-all font-mono text-xl font-bold tracking-[0.2em] text-[#1A73E8] dark:text-[#8ab4f8]">
                  {c.code}
                </span>
                <CopyButton text={c.code} label="Copy" ariaLabel={`Copy code ${c.code}`} />
              </div>
            ))}
            <span className="text-xs text-[#5f6368] dark:text-[#9aa0a6]">Verification code detected</span>
          </div>
        )}

        {/* ── Links — simple chip list, no heading ── */}
        {hasLinks && (
          <div className="mb-4 space-y-1">
            {detail.links.map((l, i) => (
              <div key={`${l.url}-${i}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#f6f8fc] dark:hover:bg-[#37393b]">
                <IconLink className="h-4 w-4 shrink-0 text-[#1A73E8] dark:text-[#8ab4f8]" />
                <div className="min-w-0 flex-1">
                  {l.text && <span className="mr-2 text-sm font-medium text-[#202124] dark:text-[#e3e3e3]">{l.text}</span>}
                  <span className="break-all font-mono text-xs text-[#5f6368] dark:text-[#9aa0a6]">{l.url}</span>
                </div>
                <CopyButton text={l.url} label="Copy" ariaLabel={`Copy link ${l.url}`} />
                <a
                  className={cx(btnSmall, 'text-xs')}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  aria-label={`Open: ${l.url}`}
                >
                  <IconExternal className="h-3.5 w-3.5" />
                  Open
                </a>
              </div>
            ))}
          </div>
        )}

        {/* ── Attachments ── */}
        {visibleAttachments.length > 0 && (
          <section aria-labelledby="att-heading" className="mb-4">
            <h2 id="att-heading" className="mb-2 text-sm font-medium text-[#5f6368] dark:text-[#9aa0a6]">
              {visibleAttachments.length} attachment{visibleAttachments.length > 1 ? 's' : ''}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visibleAttachments.map((a) => (
                <AttachmentCard key={a.id} att={a} actions={attachmentActions} />
              ))}
            </ul>
          </section>
        )}

        {/* ── Body tabs — small and unobtrusive ── */}
        <section aria-label="Message body">
          <div role="tablist" aria-label="Message view" className="mb-3 flex gap-1 border-b border-[#e0e0e0] dark:border-[#3c4043]">
            {tabs.filter((t) => t.show).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="message-tabpanel"
                onClick={() => setTab(t.id)}
                className={cx(
                  'inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
                  focusRing,
                  tab === t.id
                    ? 'border-[#1A73E8] font-medium text-[#1A73E8] dark:text-[#8ab4f8]'
                    : 'border-transparent text-[#5f6368] hover:text-[#202124] dark:text-[#9aa0a6] dark:hover:text-[#e3e3e3]',
                )}
              >
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
                onRetry={() => { setHtml(null); setHtmlError(null); setHtmlAttempt((n) => n + 1); }}
              />
            )}
            {tab === 'text' &&
              (detail.text_body ? (
                <pre className="whitespace-pre-wrap break-words rounded-xl border border-[#e0e0e0] bg-[#f6f8fc] p-5 font-mono text-[13px] leading-relaxed text-[#202124] dark:border-[#3c4043] dark:bg-[#1f1f1f] dark:text-[#e3e3e3]">
                  {detail.text_body}
                </pre>
              ) : (
                <p className="text-sm text-[#5f6368] dark:text-[#9aa0a6]">This message has no plain-text content.</p>
              ))}
            {tab === 'headers' && <HeadersView detail={detail} />}
            {tab === 'source' && <SourceView raw={raw} error={rawError} onRetry={() => setRaw(null)} onDownload={() => void downloadEml()} />}
          </div>
        </section>
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

function HtmlBodyView({ html, error, onLoadRemote, onRetry }: { html: HtmlBody | null; error: string | null; onLoadRemote: () => void; onRetry: () => void }) {
  if (error) return <ErrorBanner message={error} onRetry={onRetry} />;
  if (!html) {
    return (
      <div className="flex h-40 items-center justify-center text-[#5f6368]">
        <Spinner className="h-5 w-5" label="Loading message" />
      </div>
    );
  }
  if (html.html === null) return <p className="text-sm text-[#5f6368] dark:text-[#9aa0a6]">This message has no HTML version.</p>;
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
      <div className="h-[70vh] min-h-[60vh] resize-y overflow-hidden rounded-xl border border-[#e0e0e0] bg-white dark:border-[#3c4043]">
        <iframe
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          srcDoc={html.html}
          referrerPolicy="no-referrer"
          title="Message content"
          className="h-full w-full border-0 bg-white"
        />
      </div>
      <p className="text-xs text-[#5f6368] dark:text-[#9aa0a6]">Drag the bottom-right corner to resize. Scripts in e-mails are always disabled.</p>
    </div>
  );
}

function HeadersView({ detail }: { detail: MessageDetail }) {
  const all = detail.headers.map((h) => `${h.name}: ${h.value}`).join('\n');
  if (detail.headers.length === 0) return <p className="text-sm text-[#5f6368] dark:text-[#9aa0a6]">No headers available.</p>;
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <CopyButton text={all} label="Copy all headers" ariaLabel="Copy all headers" />
      </div>
      <div className="overflow-x-auto rounded-xl border border-[#e0e0e0] dark:border-[#3c4043]">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#f6f8fc] dark:bg-[#1f1f1f]">
            <tr>
              <th scope="col" className="px-3 py-2 font-semibold text-[#202124] dark:text-[#e3e3e3]">Name</th>
              <th scope="col" className="px-3 py-2 font-semibold text-[#202124] dark:text-[#e3e3e3]">Value</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {detail.headers.map((h, i) => (
              <tr key={`${h.name}-${i}`} className="border-t border-[#f1f3f4] align-top dark:border-[#3c4043]">
                <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-[#444746] dark:text-[#c4c7c5]">{h.name}</td>
                <td className="break-all px-3 py-1.5 text-[#5f6368] dark:text-[#9aa0a6]">{h.value}</td>
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
      <div className="flex h-40 items-center justify-center text-[#5f6368]">
        <Spinner className="h-5 w-5" label="Loading source" />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[#5f6368] dark:text-[#9aa0a6]">Original size {formatBytes(raw.size_bytes)}</span>
        <span className="flex-1" />
        <CopyButton text={raw.raw} label="Copy source" ariaLabel="Copy message source" />
        <button type="button" className={btnSmall} onClick={onDownload}>
          <IconDownload className="h-3.5 w-3.5" />
          Download .eml
        </button>
      </div>
      {raw.truncated && <InfoBanner tone="warn">Only the first part of this large message is shown. Download the .eml file for the full source.</InfoBanner>}
      <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-all rounded-xl border border-[#e0e0e0] bg-[#f6f8fc] p-3 font-mono text-xs text-[#202124] dark:border-[#3c4043] dark:bg-[#1f1f1f] dark:text-[#e3e3e3]">
        {raw.raw}
      </pre>
    </div>
  );
}
