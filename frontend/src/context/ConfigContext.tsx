import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { errorMessage } from '../api/client';
import { getConfig } from '../api/endpoints';
import type { AppConfig } from '../api/types';

interface ConfigState {
  config: AppConfig | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

const ConfigContext = createContext<ConfigState | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    getConfig(ctrl.signal)
      .then((c) => setConfig(normalizeConfig(c)))
      .catch((e) => {
        if (!ctrl.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return <ConfigContext.Provider value={{ config, error, loading, reload }}>{children}</ConfigContext.Provider>;
}

/** Fill in safe defaults so a partially populated config never breaks the UI. */
function normalizeConfig(c: Partial<AppConfig>): AppConfig {
  const domains = Array.isArray(c.domains) ? c.domains : [];
  return {
    app_name: c.app_name || 'M-Ai-L Box',
    tagline: c.tagline ?? 'Built for developers. Ready for testers.',
    domains,
    default_domain: c.default_domain || domains[0] || '',
    demo_mode: !!c.demo_mode,
    inbound_adapters: Array.isArray(c.inbound_adapters) ? c.inbound_adapters : [],
    accounts_enabled: c.accounts_enabled !== false,
    registration_open: c.registration_open !== false,
    custom_local_part_allowed: !!c.custom_local_part_allowed,
    temp_mailbox_ttl_hours: c.temp_mailbox_ttl_hours ?? 24,
    trash_retention_days: c.trash_retention_days ?? 7,
    saved_message_retention_days: c.saved_message_retention_days ?? 0,
    temp_mailbox_max_messages: c.temp_mailbox_max_messages ?? 200,
    max_message_bytes: c.max_message_bytes ?? 26214400,
    max_upload_bytes: c.max_upload_bytes ?? 26214400,
    user_quota_bytes: c.user_quota_bytes ?? 1073741824,
    scanner: c.scanner ?? 'none',
    wait_max_seconds: c.wait_max_seconds ?? 120,
  };
}

export function useConfigState(): ConfigState {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfigState must be used inside ConfigProvider');
  return ctx;
}

/** Only call below the point where the config is known to be loaded. */
export function useConfig(): AppConfig {
  const { config } = useConfigState();
  if (!config) throw new Error('Config not loaded yet');
  return config;
}
