import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../api/client';
import type { DownloadLink } from '../api/types';
import { ErrorBanner, Spinner } from './Feedback';
import { IconExternal } from './Icons';
import { Modal } from './Modal';
import { btnPrimary, btnSecondary } from './ui';

export interface PreviewRequest {
  filename: string;
  kind: 'image' | 'pdf';
  /** Fetches a fresh short-lived inline link (links expire in ~2 minutes). */
  getLink: () => Promise<DownloadLink>;
  /** Optional download action shown in the footer. */
  onDownload?: () => void;
}

export function PreviewModal({ request, onClose }: { request: PreviewRequest | null; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    setUrl(null);
    setError(null);
    if (!request) return;
    let cancelled = false;
    request
      .getLink()
      .then((l) => {
        if (!cancelled) setUrl(l.url);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [request, attempt]);

  if (!request) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={<span className="break-all">{request.filename}</span>}
      size="full"
      footer={
        <>
          {url && request.kind === 'pdf' && (
            <a className={`${btnSecondary} mr-auto`} href={url} target="_blank" rel="noopener noreferrer">
              <IconExternal className="h-4 w-4" />
              Open in new tab
            </a>
          )}
          {request.onDownload && (
            <button type="button" className={btnSecondary} onClick={request.onDownload}>
              Download
            </button>
          )}
          <button type="button" className={btnPrimary} onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!error && !url && (
        <div className="flex h-64 items-center justify-center text-slate-500">
          <Spinner className="h-6 w-6" label="Loading preview" />
        </div>
      )}
      {url && request.kind === 'image' && (
        <div className="flex justify-center rounded-lg bg-[repeating-conic-gradient(#e2e8f0_0_25%,#fff_0_50%)] bg-[length:16px_16px] p-2 dark:bg-[repeating-conic-gradient(#1e293b_0_25%,#0f172a_0_50%)]">
          <img
            src={url}
            alt={`Preview of ${request.filename}`}
            referrerPolicy="no-referrer"
            className="max-h-[70vh] max-w-full object-contain"
            onError={() => setError('The preview could not be loaded. The link may have expired.')}
          />
        </div>
      )}
      {url && request.kind === 'pdf' && (
        <object data={url} type="application/pdf" className="h-[70vh] w-full rounded-lg border border-slate-200 dark:border-slate-700" aria-label={`PDF preview of ${request.filename}`}>
          <div className="p-6 text-center text-sm">
            <p>Your browser cannot show this PDF inline.</p>
            <a className="mt-2 inline-block text-indigo-700 underline dark:text-indigo-300" href={url} target="_blank" rel="noopener noreferrer">
              Open the PDF in a new tab
            </a>
          </div>
        </object>
      )}
    </Modal>
  );
}
