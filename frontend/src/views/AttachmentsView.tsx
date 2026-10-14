import { useCallback, useEffect, useState } from 'react';
import { ApiError, errorMessage, isAbort } from '../api/client';
import * as api from '../api/endpoints';
import type { AttachmentListItem, AttachmentSort, SortOrder } from '../api/types';
import { ScanBadge, useAttachmentActions } from '../components/AttachmentCard';
import { EmptyState, ErrorBanner, Spinner } from '../components/Feedback';
import { IconDownload, IconEye, IconFolder, IconPaperclip, IconSearch, IconSort } from '../components/Icons';
import { btnSecondary, btnSmall, focusRing, input, label, select } from '../components/ui';
import type { KnownMailbox } from '../context/MailboxContext';
import { useMailboxes } from '../context/MailboxContext';
import { useSession } from '../context/SessionContext';
import { cx } from '../lib/cx';
import { formatBytes, formatFull, formatListTime, senderLabel } from '../lib/format';

export function AttachmentsView({ mailbox, onOpenMessage, refreshSignal }: { mailbox: KnownMailbox; onOpenMessage: (mid: string) => void; refreshSignal: number }) {
  const { signedIn } = useSession();
  const { markGone } = useMailboxes();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<AttachmentSort>('received');
  const [order, setOrder] = useState<SortOrder>('desc');
  const [items, setItems] = useState<AttachmentListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const actions = useAttachmentActions(mailbox.id);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(qInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api
      .listAttachments(mailbox.id, { q: q || undefined, sort, order, limit: 50 }, ctrl.signal)
      .then((res) => {
        setItems(res.items);
        setCursor(res.next_cursor);
      })
      .catch((e) => {
        if (isAbort(e)) return;
        if (e instanceof ApiError && e.status === 404) markGone(mailbox.id);
        setError(errorMessage(e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [mailbox.id, q, sort, order, attempt, refreshSignal, markGone]);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const res = await api.listAttachments(mailbox.id, { q: q || undefined, sort, order, limit: 50, cursor });
      setItems((prev) => [...prev, ...res.items.filter((i) => !prev.some((p) => p.id === i.id))]);
      setCursor(res.next_cursor);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, mailbox.id, q, sort, order]);

  return (
    <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-900">
      <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Attachments</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Every file received by {mailbox.address} (except messages in Trash).</p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <label htmlFor="att-search" className={label}>
              Search
            </label>
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                id="att-search"
                type="search"
                className={cx(input, 'pl-9')}
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="File name, sender or subject"
              />
            </div>
          </div>
          <div>
            <label htmlFor="att-sort" className={label}>
              Sort by
            </label>
            <select id="att-sort" className={select} value={sort} onChange={(e) => setSort(e.target.value as AttachmentSort)}>
              <option value="received">Date received</option>
              <option value="name">Name</option>
              <option value="size">Size</option>
              <option value="type">Type</option>
            </select>
          </div>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
            aria-label={`Sort order: ${order === 'asc' ? 'ascending' : 'descending'}. Click to reverse.`}
          >
            <IconSort className="h-4 w-4" />
            {order === 'asc' ? 'Ascending' : 'Descending'}
          </button>
        </div>

        {error && <ErrorBanner message={error} onRetry={() => setAttempt((n) => n + 1)} />}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-6 w-6" label="Loading attachments" />
          </div>
        ) : items.length === 0 && !error ? (
          <EmptyState icon={<IconPaperclip />} title={q ? 'No attachments match your search' : 'No attachments yet'}>
            <p>{q ? 'Try a different file name, sender or subject.' : 'Files attached to messages in this mailbox will be listed here.'}</p>
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                <tr>
                  <th scope="col" className="px-3 py-2 font-semibold">File</th>
                  <th scope="col" className="hidden px-3 py-2 font-semibold md:table-cell">Message</th>
                  <th scope="col" className="hidden px-3 py-2 font-semibold sm:table-cell">Size</th>
                  <th scope="col" className="hidden px-3 py-2 font-semibold lg:table-cell">Received</th>
                  <th scope="col" className="px-3 py-2 font-semibold"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => {
                  const blocked = a.scan_status === 'infected';
                  return (
                    <tr key={a.id} className="border-t border-slate-100 align-top dark:border-slate-800">
                      <td className="px-3 py-2">
                        <div className="break-all font-medium text-slate-900 dark:text-white">{a.filename || '(unnamed file)'}</div>
                        <div className="text-xs text-slate-600 dark:text-slate-400">
                          {a.content_type}
                          <span className="sm:hidden"> · {formatBytes(a.size_bytes)}</span>
                        </div>
                        <div className="mt-1">
                          <ScanBadge status={a.scan_status} />
                        </div>
                        <button
                          type="button"
                          className={cx('mt-1 block max-w-full truncate text-left text-xs text-indigo-700 hover:underline dark:text-indigo-300 md:hidden', focusRing)}
                          onClick={() => onOpenMessage(a.message_id)}
                        >
                          {a.message_subject || '(no subject)'}
                        </button>
                      </td>
                      <td className="hidden max-w-xs px-3 py-2 md:table-cell">
                        <button
                          type="button"
                          className={cx('block max-w-full truncate rounded text-left font-medium text-indigo-700 hover:underline dark:text-indigo-300', focusRing)}
                          onClick={() => onOpenMessage(a.message_id)}
                          title="Open the message"
                        >
                          {a.message_subject || '(no subject)'}
                        </button>
                        <div className="truncate text-xs text-slate-600 dark:text-slate-400">{senderLabel(a.message_from)}</div>
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2 sm:table-cell">{formatBytes(a.size_bytes)}</td>
                      <td className="hidden whitespace-nowrap px-3 py-2 lg:table-cell" title={formatFull(a.received_at)}>
                        {formatListTime(a.received_at)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button type="button" className={btnSmall} disabled={blocked} onClick={() => void actions.download(a)} aria-label={`Download ${a.filename}`}>
                            <IconDownload className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Download</span>
                          </button>
                          {a.previewable && !blocked && (
                            <button type="button" className={btnSmall} onClick={() => actions.openPreview(a)} aria-label={`Preview ${a.filename}`}>
                              <IconEye className="h-3.5 w-3.5" />
                              <span className="hidden sm:inline">Preview</span>
                            </button>
                          )}
                          {signedIn && !blocked && (
                            <button type="button" className={btnSmall} onClick={() => void actions.saveToFiles(a)} aria-label={`Save ${a.filename} to my files`}>
                              <IconFolder className="h-3.5 w-3.5" />
                              <span className="hidden xl:inline">Save</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {cursor && !loading && (
          <div className="flex justify-center">
            <button type="button" className={btnSecondary} onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
      {actions.previewModal}
    </div>
  );
}
