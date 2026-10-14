import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import * as api from '../api/endpoints';
import type { ApiKey } from '../api/types';
import { useConfig } from '../context/ConfigContext';
import type { KnownMailbox } from '../context/MailboxContext';
import { ApiKeyCreateForm, ApiKeyTable, NewKeyNotice, WaitSnippet } from './ApiKeyParts';
import { ErrorBanner, Spinner } from './Feedback';
import { Modal } from './Modal';

/** API keys bound to a single mailbox (works with the mailbox access key, no account needed). */
export function MailboxApiKeysDialog({ mailbox, onClose }: { mailbox: KnownMailbox | null; onClose: () => void }) {
  const config = useConfig();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const id = mailbox?.id ?? null;

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const res = await api.listMailboxApiKeys(id);
      setKeys(res.items);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    setKeys(null);
    setSecret(null);
    void load();
  }, [load]);

  if (!mailbox) return null;

  return (
    <Modal open onClose={onClose} title="API keys for this mailbox" description={mailbox.address} size="lg">
      <div className="space-y-6">
        {secret && <NewKeyNotice secret={secret} onDismiss={() => setSecret(null)} />}
        <section>
          <h3 className="mb-2 font-semibold">Existing keys</h3>
          {error && <ErrorBanner message={error} onRetry={() => void load()} />}
          {!keys && !error && <Spinner label="Loading API keys" />}
          {keys && (
            <ApiKeyTable
              keys={keys}
              onRevoke={async (k) => {
                await api.deleteApiKey(k.id, mailbox.id);
                setKeys((ks) => (ks ? ks.filter((x) => x.id !== k.id) : ks));
              }}
            />
          )}
        </section>
        <section>
          <h3 className="mb-2 font-semibold">Create a key</h3>
          <ApiKeyCreateForm
            scopes={['messages:read', 'messages:write', 'attachments:read']}
            onCreate={async ({ name, scopes }) => {
              const res = await api.createMailboxApiKey(mailbox.id, { name, scopes });
              setSecret(res.key);
              setKeys((ks) => [res.api_key, ...(ks ?? [])]);
            }}
          />
        </section>
        <WaitSnippet mailboxId={mailbox.id} waitMax={config.wait_max_seconds} />
      </div>
    </Modal>
  );
}
