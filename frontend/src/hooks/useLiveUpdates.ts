import { useCallback, useEffect, useRef, useState } from 'react';
import { authHeaders, buildUrl } from '../api/client';
import type { NewMessageEvent, StateEvent } from '../api/types';
import { readEventStream, SseHttpError, type SseEvent } from '../lib/sse';

export type LiveStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'polling';

interface Handlers {
  onState: (counts: StateEvent) => void;
  onMessage: (ev: NewMessageEvent) => void;
  onPoll: () => void;
  onGone: () => void;
}

const POLL_MS = 15_000;
/** The server pings every 15 s; silence for longer than this means a dead/buffered stream. */
const WATCHDOG_MS = 45_000;
const FAILURES_BEFORE_POLLING = 3;
const HEALTHY_CONNECTION_MS = 10_000;

/**
 * Live updates for one mailbox over a fetch()-streamed SSE connection, with
 * exponential-backoff reconnects and a 15 s polling fallback.
 * `version` increments whenever the message list should be refreshed.
 */
export function useLiveUpdates(mailboxId: string | null, enabled: boolean, handlers: Handlers) {
  const [status, setStatus] = useState<LiveStatus>('idle');
  const [version, setVersion] = useState(0);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!mailboxId || !enabled) {
      setStatus('idle');
      return;
    }
    let stopped = false;
    const master = new AbortController();
    let failures = 0;
    let pollTimer: number | null = null;
    let retryTimer: number | null = null;
    let lastCounts: StateEvent | null = null;

    const startPolling = () => {
      if (pollTimer !== null) return;
      pollTimer = window.setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        handlersRef.current.onPoll();
        bump();
      }, POLL_MS);
    };
    const stopPolling = () => {
      if (pollTimer !== null) window.clearInterval(pollTimer);
      pollTimer = null;
    };

    const handle = (ev: SseEvent) => {
      if (ev.event === 'ping') return;
      let data: unknown = null;
      try {
        data = ev.data ? JSON.parse(ev.data) : null;
      } catch {
        return;
      }
      if (ev.event === 'state' && data && typeof data === 'object') {
        const counts = data as StateEvent;
        handlersRef.current.onState(counts);
        if (lastCounts && (lastCounts.message_count !== counts.message_count || lastCounts.unread_count !== counts.unread_count)) {
          bump();
        }
        lastCounts = counts;
      } else if (ev.event === 'message' && data && typeof data === 'object') {
        handlersRef.current.onMessage(data as NewMessageEvent);
        bump();
      }
    };

    const connect = async () => {
      if (stopped) return;
      setStatus(pollTimer !== null ? 'polling' : failures > 0 ? 'reconnecting' : 'connecting');
      const attempt = new AbortController();
      const onMasterAbort = () => attempt.abort();
      master.signal.addEventListener('abort', onMasterAbort, { once: true });
      let watchdog = 0;
      const armWatchdog = () => {
        window.clearTimeout(watchdog);
        watchdog = window.setTimeout(() => attempt.abort(), WATCHDOG_MS);
      };
      const startedAt = Date.now();
      let gotEvent = false;
      try {
        armWatchdog();
        await readEventStream(
          buildUrl(`/mailboxes/${encodeURIComponent(mailboxId)}/events`),
          authHeaders({ mailboxId }),
          (ev) => {
            armWatchdog();
            if (!gotEvent) {
              gotEvent = true;
              stopPolling();
              setStatus('live');
            }
            handle(ev);
          },
          attempt.signal,
        );
      } catch (e) {
        if (stopped) return;
        if (e instanceof SseHttpError && e.status === 404) {
          window.clearTimeout(watchdog);
          setStatus('idle');
          handlersRef.current.onGone();
          return;
        }
      } finally {
        window.clearTimeout(watchdog);
        master.signal.removeEventListener('abort', onMasterAbort);
      }
      if (stopped) return;
      const healthy = gotEvent && Date.now() - startedAt > HEALTHY_CONNECTION_MS;
      failures = healthy ? 0 : failures + 1;
      if (failures >= FAILURES_BEFORE_POLLING) startPolling();
      setStatus(pollTimer !== null ? 'polling' : 'reconnecting');
      const base = failures === 0 ? 1000 : Math.min(30_000, 1000 * 2 ** Math.min(failures, 5));
      retryTimer = window.setTimeout(() => void connect(), base + Math.random() * 500);
    };

    void connect();

    return () => {
      stopped = true;
      master.abort();
      stopPolling();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [mailboxId, enabled, bump]);

  return { status, version, bump };
}
