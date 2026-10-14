import { useEffect, useRef, type ReactNode } from 'react';
import type { MessageSummary } from '../api/types';
import { Badge, ErrorBanner, Spinner } from '../components/Feedback';
import { IconPaperclip, IconStar } from '../components/Icons';
import { btnSecondary, checkbox, focusRing } from '../components/ui';
import { useNow } from '../hooks/useNow';
import { cx } from '../lib/cx';
import { formatFull, formatListTime, senderLabel } from '../lib/format';

interface MessageListProps {
  items: MessageSummary[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  openId: string | null;
  focusedId: string | null;
  onOpen: (id: string) => void;
  onToggleStar: (m: MessageSummary) => void;
  empty: ReactNode;
  label: string;
}

export function MessageList(props: MessageListProps) {
  const { items, loading, loadingMore, error, hasMore, onLoadMore, onRetry, selected, onToggleSelect, openId, focusedId, onOpen, onToggleStar, empty, label } = props;
  const now = useNow(30_000);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreRef.current();
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, items.length]);

  // Keep the keyboard-focused row visible.
  useEffect(() => {
    if (!focusedId) return;
    const row = document.getElementById(`msg-row-${focusedId}`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [focusedId]);

  if (loading) {
    return (
      <div aria-busy="true" aria-label="Loading messages">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div className="mt-1 h-4 w-4 rounded bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800" />
            <div className="flex-1 space-y-2">
              <div className="flex justify-between gap-4">
                <div className="h-3.5 w-1/3 rounded bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800" />
                <div className="h-3 w-12 rounded bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800" />
              </div>
              <div className="h-3.5 w-2/3 rounded bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800" />
              <div className="h-3 w-5/6 rounded bg-slate-100 motion-safe:animate-pulse dark:bg-slate-800/60" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className="p-4">
        <ErrorBanner message={error} onRetry={onRetry} />
      </div>
    );
  }

  if (items.length === 0) return <>{empty}</>;

  return (
    <div>
      {error && (
        <div className="p-3">
          <ErrorBanner message={error} onRetry={onRetry} />
        </div>
      )}
      <div role="grid" aria-label={label} aria-rowcount={hasMore ? -1 : items.length} aria-multiselectable="true">
        {items.map((m, idx) => {
          const isOpen = openId === m.id;
          const isFocused = focusedId === m.id;
          const isChecked = selected.has(m.id);
          const sender = senderLabel(m.from);
          return (
            <div
              key={m.id}
              id={`msg-row-${m.id}`}
              role="row"
              aria-rowindex={idx + 1}
              aria-selected={isOpen || isChecked}
              className={cx(
                'group relative flex items-start gap-1 border-b border-slate-100 py-2 pl-2 pr-3 dark:border-slate-800',
                isOpen
                  ? 'bg-indigo-50 dark:bg-indigo-500/15'
                  : isChecked
                    ? 'bg-sky-50 dark:bg-sky-500/10'
                    : m.is_read
                      ? 'bg-slate-50/60 hover:bg-slate-100 dark:bg-transparent dark:hover:bg-slate-800/60'
                      : 'bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800/60',
                isFocused && 'ring-2 ring-inset ring-indigo-400 dark:ring-indigo-500',
              )}
            >
              <div role="gridcell" className="flex flex-col items-center gap-1 pt-1">
                <input
                  type="checkbox"
                  className={checkbox}
                  checked={isChecked}
                  onChange={() => onToggleSelect(m.id)}
                  aria-label={`Select message from ${sender}: ${m.subject || '(no subject)'}`}
                />
                <button
                  type="button"
                  onClick={() => onToggleStar(m)}
                  className={cx('rounded p-0.5', focusRing, m.is_starred ? 'text-amber-500' : 'text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-200')}
                  aria-pressed={m.is_starred}
                  aria-label={m.is_starred ? 'Unstar' : 'Star'}
                  title={m.is_starred ? 'Starred' : 'Not starred'}
                >
                  <IconStar filled={m.is_starred} className="h-4 w-4" />
                </button>
              </div>
              <div role="gridcell" className="min-w-0 flex-1">
                <button
                  type="button"
                  data-msg-open={m.id}
                  onClick={() => onOpen(m.id)}
                  className={cx('block w-full rounded-md px-1.5 py-0.5 text-left', focusRing)}
                  aria-label={`${m.is_read ? '' : 'Unread. '}From ${sender}. ${m.subject || '(no subject)'}. ${formatFull(m.received_at)}${m.has_attachments ? '. Has attachments' : ''}${m.has_otp ? '. Contains a code' : ''}${m.is_demo ? '. Sample message' : ''}`}
                >
                  <div className="flex items-baseline gap-2">
                    {!m.is_read && <span className="h-2 w-2 shrink-0 self-center rounded-full bg-indigo-600 dark:bg-indigo-400" aria-hidden="true" />}
                    <span
                      className={cx('min-w-0 flex-1 truncate text-sm', m.is_read ? 'text-slate-700 dark:text-slate-300' : 'font-bold text-slate-950 dark:text-white')}
                      title={m.from?.address}
                    >
                      {sender}
                    </span>
                    {m.has_attachments && <IconPaperclip className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />}
                    <time
                      dateTime={m.received_at}
                      title={`Received ${formatFull(m.received_at)}`}
                      className={cx('shrink-0 text-xs', m.is_read ? 'text-slate-600 dark:text-slate-400' : 'font-bold text-slate-900 dark:text-white')}
                    >
                      {formatListTime(m.received_at, now)}
                    </time>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className={cx('min-w-0 truncate text-sm', m.is_read ? 'text-slate-700 dark:text-slate-300' : 'font-semibold text-slate-950 dark:text-white')}>
                      {m.subject || '(no subject)'}
                    </span>
                    {m.has_otp && <Badge tone="indigo">OTP</Badge>}
                    {m.is_demo && <Badge tone="purple">Sample</Badge>}
                  </div>
                  <div className="mt-0.5 line-clamp-1 text-xs text-slate-600 dark:text-slate-400">{m.snippet}</div>
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center p-4">
          {loadingMore ? (
            <Spinner className="h-5 w-5" label="Loading more messages" />
          ) : (
            <button type="button" className={btnSecondary} onClick={onLoadMore}>
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
