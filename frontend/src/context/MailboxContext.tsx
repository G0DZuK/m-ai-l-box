import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, setMailboxToken, setMailboxTokens } from '../api/client';
import * as api from '../api/endpoints';
import type { Mailbox, StateEvent } from '../api/types';
import { KEYS, loadStoredMailboxes, readString, saveStoredMailboxes, writeString, type StoredMailbox } from '../lib/storage';
import { useSession } from './SessionContext';

/** A mailbox this browser knows about: via a local access key, the signed-in account, or both. */
export interface KnownMailbox {
  id: string;
  address: string;
  label: string | null;
  expires_at: string | null;
  is_demo: boolean;
  /** Access key stored in this browser (null for account-only mailboxes). */
  token: string | null;
  /** Saved to the signed-in account. */
  saved: boolean;
  /** Latest copy from the server, if fetched. */
  info: Mailbox | null;
  /** The server answered 404: the mailbox expired or was removed. */
  gone: boolean;
}

/** Best available Mailbox object for a known mailbox (server copy, or rebuilt from local data). */
export function toMailbox(k: KnownMailbox): Mailbox {
  if (k.info) return k.info;
  const at = k.address.lastIndexOf('@');
  return {
    id: k.id,
    address: k.address,
    local_part: at > 0 ? k.address.slice(0, at) : k.address,
    domain: at > 0 ? k.address.slice(at + 1) : '',
    label: k.label,
    created_at: '',
    expires_at: k.expires_at,
    is_saved: k.saved,
    is_demo: k.is_demo,
    disabled: false,
    message_count: 0,
    unread_count: 0,
    storage_bytes: 0,
    token_hint: '',
  };
}

interface MailboxState {
  mailboxes: KnownMailbox[];
  active: KnownMailbox | null;
  setActive: (id: string) => void;
  addMailbox: (mailbox: Mailbox, token: string, activate?: boolean) => void;
  removeLocal: (id: string) => void;
  replaceToken: (mailbox: Mailbox, token: string) => void;
  updateInfo: (mailbox: Mailbox) => void;
  markGone: (id: string) => void;
  refreshInfo: (id: string) => Promise<void>;
  refreshSaved: () => Promise<void>;
  setCounts: (id: string, counts: StateEvent) => void;
  adjustUnread: (id: string, delta: number) => void;
}

const MailboxContext = createContext<MailboxState | null>(null);

const POLL_OTHERS_MS = 60_000;

export function MailboxProvider({ children }: { children: ReactNode }) {
  const { signedIn } = useSession();
  const [stored, setStored] = useState<StoredMailbox[]>(() => {
    const list = loadStoredMailboxes();
    setMailboxTokens(list);
    return list;
  });
  const [saved, setSaved] = useState<Mailbox[]>([]);
  const [infos, setInfos] = useState<Record<string, Mailbox>>({});
  const [gone, setGone] = useState<Record<string, boolean>>({});
  const [preferredId, setPreferredId] = useState<string | null>(() => readString(KEYS.active));

  // Persist local credentials and keep the request layer's token registry in sync.
  const firstRun = useRef(true);
  useEffect(() => {
    setMailboxTokens(stored);
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    saveStoredMailboxes(stored);
  }, [stored]);

  const mailboxes = useMemo<KnownMailbox[]>(() => {
    const savedIds = new Set(saved.map((m) => m.id));
    const list: KnownMailbox[] = stored.map((s) => {
      const info = infos[s.id] ?? null;
      return {
        id: s.id,
        address: info?.address ?? s.address,
        label: info ? info.label : s.label,
        expires_at: info ? info.expires_at : s.expires_at,
        is_demo: info?.is_demo ?? s.is_demo,
        token: s.token,
        saved: savedIds.has(s.id) || !!info?.is_saved,
        info,
        gone: !!gone[s.id],
      };
    });
    const localIds = new Set(stored.map((s) => s.id));
    for (const m of saved) {
      if (localIds.has(m.id)) continue;
      const info = infos[m.id] ?? m;
      list.push({
        id: m.id,
        address: info.address,
        label: info.label,
        expires_at: info.expires_at,
        is_demo: info.is_demo,
        token: null,
        saved: true,
        info,
        gone: !!gone[m.id],
      });
    }
    return list;
  }, [stored, saved, infos, gone]);

  const active = useMemo(() => {
    if (mailboxes.length === 0) return null;
    return mailboxes.find((m) => m.id === preferredId) ?? mailboxes[0];
  }, [mailboxes, preferredId]);

  const setActive = useCallback((id: string) => {
    setPreferredId(id);
    writeString(KEYS.active, id);
  }, []);

  const updateInfo = useCallback((mailbox: Mailbox) => {
    setInfos((prev) => ({ ...prev, [mailbox.id]: mailbox }));
    setGone((prev) => (prev[mailbox.id] ? { ...prev, [mailbox.id]: false } : prev));
    setStored((prev) => {
      const idx = prev.findIndex((s) => s.id === mailbox.id);
      if (idx === -1) return prev;
      const cur = prev[idx];
      if (
        cur.address === mailbox.address &&
        cur.label === mailbox.label &&
        cur.expires_at === mailbox.expires_at &&
        cur.is_demo === mailbox.is_demo
      ) {
        return prev;
      }
      const next = prev.slice();
      next[idx] = { ...cur, address: mailbox.address, label: mailbox.label, expires_at: mailbox.expires_at, is_demo: mailbox.is_demo };
      return next;
    });
    setSaved((prev) => (prev.some((m) => m.id === mailbox.id) ? prev.map((m) => (m.id === mailbox.id ? mailbox : m)) : prev));
  }, []);

  const addMailbox = useCallback(
    (mailbox: Mailbox, token: string, activate = true) => {
      setMailboxToken(mailbox.id, token);
      setStored((prev) => [
        {
          id: mailbox.id,
          address: mailbox.address,
          token,
          label: mailbox.label,
          expires_at: mailbox.expires_at,
          is_demo: mailbox.is_demo,
        },
        ...prev.filter((s) => s.id !== mailbox.id),
      ]);
      setInfos((prev) => ({ ...prev, [mailbox.id]: mailbox }));
      setGone((prev) => ({ ...prev, [mailbox.id]: false }));
      if (activate) setActive(mailbox.id);
    },
    [setActive],
  );

  const replaceToken = useCallback(
    (mailbox: Mailbox, token: string) => {
      setMailboxToken(mailbox.id, token);
      setStored((prev) => {
        if (prev.some((s) => s.id === mailbox.id)) return prev.map((s) => (s.id === mailbox.id ? { ...s, token } : s));
        return [
          { id: mailbox.id, address: mailbox.address, token, label: mailbox.label, expires_at: mailbox.expires_at, is_demo: mailbox.is_demo },
          ...prev,
        ];
      });
      updateInfo(mailbox);
    },
    [updateInfo],
  );

  const removeLocal = useCallback((id: string) => {
    setStored((prev) => prev.filter((s) => s.id !== id));
    setInfos((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSaved((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const markGone = useCallback((id: string) => setGone((prev) => ({ ...prev, [id]: true })), []);

  const refreshInfo = useCallback(
    async (id: string) => {
      try {
        const m = await api.getMailbox(id);
        updateInfo(m);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) markGone(id);
      }
    },
    [updateInfo, markGone],
  );

  const refreshSaved = useCallback(async () => {
    if (!signedIn) {
      setSaved([]);
      return;
    }
    try {
      const res = await api.getMyMailboxes();
      setSaved(res.items);
      setInfos((prev) => {
        const next = { ...prev };
        for (const m of res.items) next[m.id] = m;
        return next;
      });
    } catch {
      // keep the previous list; the account menu surfaces session problems
    }
  }, [signedIn]);

  useEffect(() => {
    void refreshSaved();
  }, [refreshSaved]);

  // Initial fetch of every locally stored mailbox (counts, expiry, existence).
  const initialIds = useRef(stored.map((s) => s.id));
  useEffect(() => {
    for (const id of initialIds.current) void refreshInfo(id);
  }, [refreshInfo]);

  // Poll unread counts of the non-active mailboxes every 60 s.
  const activeId = active?.id ?? null;
  const mailboxesRef = useRef(mailboxes);
  mailboxesRef.current = mailboxes;
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      for (const m of mailboxesRef.current) {
        if (m.id === activeId || m.gone) continue;
        if (!m.token && !signedIn) continue;
        void refreshInfo(m.id);
      }
    }, POLL_OTHERS_MS);
    return () => window.clearInterval(timer);
  }, [activeId, signedIn, refreshInfo]);

  const setCounts = useCallback((id: string, counts: StateEvent) => {
    setInfos((prev) => {
      const cur = prev[id];
      if (!cur || (cur.message_count === counts.message_count && cur.unread_count === counts.unread_count)) return prev;
      return { ...prev, [id]: { ...cur, message_count: counts.message_count, unread_count: counts.unread_count } };
    });
  }, []);

  const adjustUnread = useCallback((id: string, delta: number) => {
    setInfos((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      return { ...prev, [id]: { ...cur, unread_count: Math.max(0, cur.unread_count + delta) } };
    });
  }, []);

  const value = useMemo<MailboxState>(
    () => ({
      mailboxes,
      active,
      setActive,
      addMailbox,
      removeLocal,
      replaceToken,
      updateInfo,
      markGone,
      refreshInfo,
      refreshSaved,
      setCounts,
      adjustUnread,
    }),
    [mailboxes, active, setActive, addMailbox, removeLocal, replaceToken, updateInfo, markGone, refreshInfo, refreshSaved, setCounts, adjustUnread],
  );

  return <MailboxContext.Provider value={value}>{children}</MailboxContext.Provider>;
}

export function useMailboxes(): MailboxState {
  const ctx = useContext(MailboxContext);
  if (!ctx) throw new Error('useMailboxes must be used inside MailboxProvider');
  return ctx;
}
