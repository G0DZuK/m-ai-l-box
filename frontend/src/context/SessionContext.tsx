import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, setSessionToken } from '../api/client';
import * as api from '../api/endpoints';
import type { Usage, User } from '../api/types';
import { KEYS, readString, writeString } from '../lib/storage';

interface SessionState {
  token: string | null;
  user: User | null;
  usage: Usage | null;
  /** True once the stored session (if any) has been checked. */
  ready: boolean;
  signedIn: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Forget the session locally (e.g. after deleting the account). */
  clear: () => void;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

function initialToken(): string | null {
  const token = readString(KEYS.session) || null;
  setSessionToken(token);
  return token;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [user, setUser] = useState<User | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [ready, setReady] = useState<boolean>(() => !token);

  const apply = useCallback((t: string | null) => {
    setSessionToken(t);
    writeString(KEYS.session, t);
    setToken(t);
    if (!t) {
      setUser(null);
      setUsage(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const me = await api.getMe();
      setUser(me.user);
      setUsage(me.usage);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) apply(null);
    } finally {
      setReady(true);
    }
  }, [token, apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await api.login(email, password);
      apply(res.token);
      setUser(res.user);
      setReady(true);
    },
    [apply],
  );

  const register = useCallback(
    async (email: string, password: string) => {
      const res = await api.register(email, password);
      apply(res.token);
      setUser(res.user);
      setReady(true);
    },
    [apply],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Even if the server call fails, forget the session locally.
    }
    apply(null);
  }, [apply]);

  const clear = useCallback(() => apply(null), [apply]);

  const value = useMemo<SessionState>(
    () => ({
      token,
      user,
      usage,
      ready,
      signedIn: !!token && !!user,
      isAdmin: !!user?.is_admin,
      signIn,
      register,
      signOut,
      clear,
      refresh,
    }),
    [token, user, usage, ready, signIn, register, signOut, clear, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
