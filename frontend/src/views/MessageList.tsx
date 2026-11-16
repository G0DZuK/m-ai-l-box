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

  // Infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) loadMoreRef.current(); },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, items.length]);

  // Keep keyboard-focused row visible
  useEffect(() => {
    if (!focusedId) return;
    const row = document.getElementById(`msg-row-${focusedId}`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [focusedId]);

  if (loading) {
    return (
      <div aria-busy="true" aria-label="Loading messages">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-[#f1f3f4] px-4 py-3 dark:border-[#3c4043]">
            <div className="h-4 w-4 rounded bg-[#e8eaed] motion-safe:animate-pulse dark:bg-[#3c4043]" />
            <div className="h-4 w-4 rounded bg-[#e8eaed] motion-safe:animate-pulse dark:bg-[#3c4043]" />
            <div className="h-3.5 w-28 rounded bg-[#e8eaed] motion-safe:animate-pulse dark:bg-[#3c4043]" />
            <div className="h-3.5 flex-1 rounded bg-[#f1f3f4] motion-safe:animate-pulse dark:bg-[#3c4043]" />
            <div className="h-3 w-10 rounded bg-[#e8eaed] motion-safe:animate-pulse dark:bg-[#3c4043]" />
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
          const isUnread = !m.is_read;

          return (
            <div
              key={m.id}
              id={`msg-row-${m.id}`}
              role="row"
              aria-rowindex={idx + 1}
              aria-selected={isOpen || isChecked}
              className={cx(
                'group relative flex items-center gap-1 border-b py-1 pl-2 pr-4 transition-colors',
                // Gmail: unread = white, bold. Read = light grey bg. Hover = slightly darker. Open = blue tint.
                isOpen
                  ? 'border-[#c5cae9] bg-[#E8F0FE] dark:border-[#1a3a5c] dark:bg-[#1a3a5c]'
                  : isChecked
                    ? 'border-[#c5d8f7] bg-[#EAF1FB] dark:border-[#1a3050] dark:bg-[#1a3050]'
                    : isUnread
                      ? 'border-[#f1f3f4] bg-white hover:bg-[#F2F6FC] dark:border-[#3c4043] dark:bg-[#2d2e30] dark:hover:bg-[#37393b]'
                      : 'border-[#f1f3f4] bg-[#F6F8FC] hover:bg-[#F2F6FC] dark:border-[#3c4043] dark:bg-transparent dark:hover:bg-[#37393b]',
                isFocused && 'ring-2 ring-inset ring-[#1A73E8] dark:ring-[#8ab4f8]',
              )}
            >
              {/* Hover left accent bar — Gmail detail */}
              {!isOpen && (
                <span className="absolute left-0 top-0 h-full w-1 rounded-r bg-transparent group-hover:bg-[#1A73E8] transition-colors" aria-hidden="true" />
              )}

              {/* Checkbox + Star */}
              <div role="gridcell" className="flex shrink-0 items-center gap-1 pl-1 pr-1">
                <input
                  type="checkbox"
                  className={cx(checkbox, 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100', isChecked && 'opacity-100')}
                  checked={isChecked}
                  onChange={() => onToggleSelect(m.id)}
                  aria-label={`Select message from ${sender}: ${m.subject || '(no subject)'}`}
                />
                <button
                  type="button"
                  onClick={() => onToggleStar(m)}
                  className={cx(
                    'rounded p-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity',
                    focusRing,
                    m.is_starred ? 'opacity-100 text-[#f9ab00]' : 'text-[#9aa0a6] hover:text-[#5f6368] dark:hover:text-[#c4c7c5]',
                  )}
                  aria-pressed={m.is_starred}
                  aria-label={m.is_starred ? 'Unstar' : 'Star'}
                  title={m.is_starred ? 'Starred' : 'Not starred'}
                >
                  <IconStar filled={m.is_starred} className="h-4 w-4" />
                </button>
              </div>

              {/* Row content — click to open */}
              <div role="gridcell" className="min-w-0 flex-1">
                <button
                  type="button"
                  data-msg-open={m.id}
                  onClick={() => onOpen(m.id)}
                  className={cx('flex w-full items-center gap-2 rounded px-1 py-1.5 text-left', focusRing)}
                  aria-label={`${isUnread ? 'Unread. ' : ''}From ${sender}. ${m.subject || '(no subject)'}. ${formatFull(m.received_at)}${m.has_attachments ? '. Has attachments' : ''}${m.has_otp ? '. Contains a code' : ''}${m.is_demo ? '. Sample message' : ''}`}
                >
                  {/* Sender — fixed width, truncated */}
                  <span
                    className={cx(
                      'w-40 shrink-0 truncate text-sm',
                      isUnread ? 'font-bold text-[#202124] dark:text-[#e3e3e3]' : 'font-normal text-[#444746] dark:text-[#9aa0a6]',
                    )}
                    title={m.from?.address}
                  >
                    {/* Unread dot */}
                    {isUnread && (
                      <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#1A73E8] align-middle" aria-hidden="true" />
                    )}
                    {sender}
                  </span>

                  {/* Subject + snippet */}
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className={cx(isUnread ? 'font-semibold text-[#202124] dark:text-[#e3e3e3]' : 'text-[#444746] dark:text-[#9aa0a6]')}>
                      {m.subject || '(no subject)'}
                    </span>
                    {m.snippet && (
                      <span className="text-[#5f6368] dark:text-[#9aa0a6]">
                        {' '}— {m.snippet}
                      </span>
                    )}
                  </span>

                  {/* Badges */}
                  <span className="flex shrink-0 items-center gap-1">
                    {m.has_otp && <Badge tone="indigo">OTP</Badge>}
                    {m.is_demo && <Badge tone="purple">Sample</Badge>}
                    {m.has_attachments && (
                      <IconPaperclip className="h-4 w-4 text-[#5f6368] dark:text-[#9aa0a6]" aria-label="Has attachments" />
                    )}
                  </span>

                  {/* Timestamp */}
                  <time
                    dateTime={m.received_at}
                    title={`Received ${formatFull(m.received_at)}`}
                    className={cx(
                      'ml-2 shrink-0 text-xs',
                      isUnread ? 'font-bold text-[#202124] dark:text-[#e3e3e3]' : 'text-[#5f6368] dark:text-[#9aa0a6]',
                    )}
                  >
                    {formatListTime(m.received_at, now)}
                  </time>
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
