import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import * as api from '../api/endpoints';
import type { ApiKey } from '../api/types';
import { ApiKeyCreateForm, ApiKeyTable, NewKeyNotice, WaitSnippet } from '../components/ApiKeyParts';
import { ErrorBanner, Spinner } from '../components/Feedback';
import { card } from '../components/ui';
import { useConfig } from '../context/ConfigContext';
import { useMailboxes } from '../context/MailboxContext';

export function ApiKeysView() {
  const config = useConfig();
  const { mailboxes, active } = useMailboxes();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.listApiKeys();
      setKeys(res.items);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saved = mailboxes.filter((m) => m.saved && !m.gone);
  const addressOf = (id: string) => mailboxes.find((m) => m.id === id)?.address ?? 'one mailbox';
  const snippetMailbox = active && active.saved ? active.id : saved[0]?.id;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">API keys</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Let test scripts and CI pipelines read your saved mailboxes without signing in. Send the key in the{' '}
            <span className="font-mono">Authorization: Bearer</span> header.
          </p>
        </div>

        {secret && <NewKeyNotice secret={secret} onDismiss={() => setSecret(null)} />}

        <section className={card} aria-labelledby="ak-create">
          <h2 id="ak-create" className="mb-3 text-base font-semibold">
            Create a key
          </h2>
          <ApiKeyCreateForm
            mailboxOptions={saved.map((m) => ({ id: m.id, address: m.address }))}
            onCreate={async (body) => {
              const res = await api.createApiKey(body);
              setSecret(res.key);
              setKeys((k) => [res.api_key, ...(k ?? [])]);
            }}
          />
        </section>

        <section className={card} aria-labelledby="ak-list">
          <h2 id="ak-list" className="mb-3 text-base font-semibold">
            Your keys
          </h2>
          {error && <ErrorBanner message={error} onRetry={() => void load()} />}
          {!keys && !error && <Spinner label="Loading API keys" />}
          {keys && (
            <ApiKeyTable
              keys={keys}
              mailboxLabel={addressOf}
              onRevoke={async (k) => {
                await api.deleteApiKey(k.id);
                setKeys((ks) => (ks ? ks.filter((x) => x.id !== k.id) : ks));
              }}
            />
          )}
        </section>

        <section className={card}>
          <WaitSnippet mailboxId={snippetMailbox} waitMax={config.wait_max_seconds} />
        </section>
      </div>
    </div>
  );
}
