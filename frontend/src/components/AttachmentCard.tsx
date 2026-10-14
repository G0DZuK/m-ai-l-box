import { useCallback, useState } from 'react';
import { ApiError, errorMessage } from '../api/client';
import * as api from '../api/endpoints';
import type { Attachment, ScanStatus } from '../api/types';
import { useSession } from '../context/SessionContext';
import { useToast } from '../context/ToastContext';
import { triggerDownload } from '../lib/download';
import { formatBytes } from '../lib/format';
import { Badge } from './Feedback';
import { IconDownload, IconEye, IconFile, IconFolder } from './Icons';
import { PreviewModal, type PreviewRequest } from './PreviewModal';
import { btnSmall } from './ui';

export function ScanBadge({ status }: { status: ScanStatus }) {
  switch (status) {
    case 'infected':
      return <Badge tone="red">Blocked: malware detected</Badge>;
    case 'clean':
      return <Badge tone="green">Scanned: clean</Badge>;
    case 'pending':
      return <Badge tone="amber">Scan pending</Badge>;
    case 'error':
      return <Badge tone="amber">Scan failed</Badge>;
    default:
      return <Badge tone="neutral">Not scanned</Badge>;
  }
}

/** Download / preview / save-to-files actions for message attachments, plus the preview modal. */
export function useAttachmentActions(mailboxId: string) {
  const { toast } = useToast();
  const [preview, setPreview] = useState<PreviewRequest | null>(null);

  const download = useCallback(
    async (att: Pick<Attachment, 'id' | 'filename' | 'scan_status'>) => {
      if (att.scan_status === 'infected') return;
      try {
        const link = await api.getAttachmentDownloadLink(mailboxId, att.id, 'attachment');
        triggerDownload(link.url, att.filename);
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) toast('This file is blocked and cannot be downloaded.', 'error');
        else toast(errorMessage(e), 'error');
      }
    },
    [mailboxId, toast],
  );

  const openPreview = useCallback(
    (att: Pick<Attachment, 'id' | 'filename' | 'previewable' | 'scan_status'>) => {
      if (!att.previewable || att.scan_status === 'infected') return;
      setPreview({
        filename: att.filename,
        kind: att.previewable,
        getLink: () => api.getAttachmentDownloadLink(mailboxId, att.id, 'inline'),
        onDownload: () => void download(att),
      });
    },
    [mailboxId, download],
  );

  const saveToFiles = useCallback(
    async (att: Pick<Attachment, 'id' | 'filename'>) => {
      try {
        await api.saveAttachmentToFiles(mailboxId, att.id);
        toast(`Saved "${att.filename}" to My files.`, 'success');
      } catch (e) {
        if (e instanceof ApiError && e.status === 507) toast('Your storage is full. Delete some files or messages and try again.', 'error');
        else toast(errorMessage(e), 'error');
      }
    },
    [mailboxId, toast],
  );

  const previewModal = <PreviewModal request={preview} onClose={() => setPreview(null)} />;

  return { download, openPreview, saveToFiles, previewModal };
}

interface CardProps {
  att: Attachment;
  actions: ReturnType<typeof useAttachmentActions>;
}

export function AttachmentCard({ att, actions }: CardProps) {
  const { signedIn } = useSession();
  const blocked = att.scan_status === 'infected';
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-slate-100 p-2 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <IconFile className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="break-all text-sm font-medium text-slate-900 dark:text-white" title={att.filename}>
            {att.filename || '(unnamed file)'}
          </div>
          <div className="text-xs text-slate-600 dark:text-slate-400">
            {att.content_type} · {formatBytes(att.size_bytes)}
            {att.is_inline && ' · inline'}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ScanBadge status={att.scan_status} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnSmall} disabled={blocked} onClick={() => void actions.download(att)} aria-label={`Download ${att.filename}`}>
          <IconDownload className="h-3.5 w-3.5" />
          Download
        </button>
        {att.previewable && !blocked && (
          <button type="button" className={btnSmall} onClick={() => actions.openPreview(att)} aria-label={`Preview ${att.filename}`}>
            <IconEye className="h-3.5 w-3.5" />
            Preview
          </button>
        )}
        {signedIn && !blocked && (
          <button type="button" className={btnSmall} onClick={() => void actions.saveToFiles(att)} aria-label={`Save ${att.filename} to my files`}>
            <IconFolder className="h-3.5 w-3.5" />
            Save to my files
          </button>
        )}
      </div>
    </li>
  );
}
