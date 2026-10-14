import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, errorMessage, isAbort } from '../api/client';
import * as api from '../api/endpoints';
import type { FileSort, SortOrder, StoredFile } from '../api/types';
import { ScanBadge } from '../components/AttachmentCard';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState, ErrorBanner, Spinner, UsageBar } from '../components/Feedback';
import { IconDownload, IconEye, IconFolder, IconPencil, IconSearch, IconSort, IconTrash, IconUpload } from '../components/Icons';
import { PreviewModal, type PreviewRequest } from '../components/PreviewModal';
import { PromptDialog } from '../components/PromptDialog';
import { btnPrimary, btnSecondary, btnSmall, input, label, select } from '../components/ui';
import { useConfig } from '../context/ConfigContext';
import { useSession } from '../context/SessionContext';
import { useToast } from '../context/ToastContext';
import { cx } from '../lib/cx';
import { triggerDownload } from '../lib/download';
import { formatBytes, formatFull, formatRelative } from '../lib/format';

interface Upload {
  id: number;
  name: string;
  progress: number;
  error: string | null;
}

function uploadErrorMessage(e: unknown, maxBytes: number): string {
  if (e instanceof ApiError) {
    if (e.status === 413) return `This file is too large. The limit is ${formatBytes(maxBytes)} per file.`;
    if (e.status === 507) return 'Your storage is full. Delete some files or saved messages, then try again.';
  }
  return errorMessage(e);
}

export function FilesView() {
  const config = useConfig();
  const session = useSession();
  const { toast } = useToast();
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<FileSort>('created');
  const [order, setOrder] = useState<SortOrder>('desc');
  const [files, setFiles] = useState<StoredFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [renaming, setRenaming] = useState<StoredFile | null>(null);
  const [deleting, setDeleting] = useState<StoredFile | null>(null);
  const [preview, setPreview] = useState<PreviewRequest | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadId = useRef(1);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(qInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    api
      .listFiles({ q: q || undefined, sort, order }, ctrl.signal)
      .then((res) => setFiles(res.items))
      .catch((e) => {
        if (!isAbort(e)) setError(errorMessage(e));
      });
    return () => ctrl.abort();
  }, [q, sort, order, attempt]);

  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
    void session.refresh();
  }, [session]);

  const uploadFiles = useCallback(
    async (list: FileList | File[]) => {
      const arr = Array.from(list);
      for (const file of arr) {
        const id = uploadId.current++;
        if (file.size > config.max_upload_bytes) {
          setUploads((u) => [...u, { id, name: file.name, progress: 0, error: uploadErrorMessage(new ApiError(413, ''), config.max_upload_bytes) }]);
          continue;
        }
        setUploads((u) => [...u, { id, name: file.name, progress: 0, error: null }]);
        try {
          await api.uploadFile(file, (p) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: p } : x))));
          setUploads((u) => u.filter((x) => x.id !== id));
          toast(`Uploaded "${file.name}".`, 'success');
        } catch (e) {
          setUploads((u) => u.map((x) => (x.id === id ? { ...x, error: uploadErrorMessage(e, config.max_upload_bytes) } : x)));
        }
      }
      reload();
    },
    [config.max_upload_bytes, reload, toast],
  );

  const download = async (f: StoredFile) => {
    try {
      const link = await api.getFileDownloadLink(f.id, 'attachment');
      triggerDownload(link.url, f.filename);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const usage = session.usage;

  return (
    <div
      className="relative flex-1 overflow-y-auto bg-white dark:bg-slate-900"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-2xl border-4 border-dashed border-indigo-500 bg-indigo-50/90 text-lg font-semibold text-indigo-900 dark:bg-indigo-950/90 dark:text-indigo-100">
          Drop files to upload
        </div>
      )}
      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">My files</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Personal storage for test fixtures and saved attachments. Up to {formatBytes(config.max_upload_bytes)} per file.
            </p>
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              id="file-upload"
              onChange={(e) => {
                if (e.target.files?.length) void uploadFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button type="button" className={btnPrimary} onClick={() => fileInputRef.current?.click()}>
              <IconUpload className="h-4 w-4" />
              Upload files
            </button>
          </div>
        </div>

        {usage && (
          <UsageBar used={usage.used_bytes} quota={usage.quota_bytes} label={`${formatBytes(usage.used_bytes)} of ${formatBytes(usage.quota_bytes)} used (files: ${formatBytes(usage.files_bytes)}, saved mail: ${formatBytes(usage.messages_bytes)})`} />
        )}

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 px-4 py-6 text-sm text-slate-600 hover:border-indigo-400 hover:bg-indigo-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-indigo-950/30"
        >
          <IconUpload className="h-6 w-6" />
          <span>
            <strong className="text-slate-900 dark:text-white">Drag and drop files here</strong> or click to choose
          </span>
        </button>

        {uploads.length > 0 && (
          <ul className="space-y-2" aria-label="Uploads">
            {uploads.map((u) => (
              <li key={u.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{u.name}</span>
                  {u.error ? (
                    <button type="button" className={btnSmall} onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}>
                      Dismiss
                    </button>
                  ) : (
                    <span className="text-xs text-slate-600 dark:text-slate-400">{Math.round(u.progress * 100)}%</span>
                  )}
                </div>
                {u.error ? (
                  <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
                    {u.error}
                  </p>
                ) : (
                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
                    role="progressbar"
                    aria-label={`Uploading ${u.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(u.progress * 100)}
                  >
                    <div className="h-full bg-indigo-600 transition-[width] dark:bg-indigo-400" style={{ width: `${u.progress * 100}%` }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <label htmlFor="files-search" className={label}>
              Search
            </label>
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input id="files-search" type="search" className={cx(input, 'pl-9')} value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="File name" />
            </div>
          </div>
          <div>
            <label htmlFor="files-sort" className={label}>
              Sort by
            </label>
            <select id="files-sort" className={select} value={sort} onChange={(e) => setSort(e.target.value as FileSort)}>
              <option value="created">Date added</option>
              <option value="name">Name</option>
              <option value="size">Size</option>
              <option value="type">Type</option>
            </select>
          </div>
          <button type="button" className={btnSecondary} onClick={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))} aria-label={`Sort order: ${order === 'asc' ? 'ascending' : 'descending'}. Click to reverse.`}>
            <IconSort className="h-4 w-4" />
            {order === 'asc' ? 'Ascending' : 'Descending'}
          </button>
        </div>

        {error && <ErrorBanner message={error} onRetry={() => setAttempt((n) => n + 1)} />}

        {!files && !error ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-6 w-6" label="Loading files" />
          </div>
        ) : files && files.length === 0 ? (
          <EmptyState icon={<IconFolder />} title={q ? 'No files match your search' : 'No files yet'}>
            <p>{q ? 'Try a different name.' : 'Upload files here, or use "Save to my files" on any attachment.'}</p>
          </EmptyState>
        ) : files ? (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
            {files.map((f) => {
              const blocked = f.scan_status === 'infected';
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="break-all text-sm font-medium text-slate-900 dark:text-white">{f.filename}</div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
                      <span>{f.content_type}</span>
                      <span>·</span>
                      <span>{formatBytes(f.size_bytes)}</span>
                      <span>·</span>
                      <span title={formatFull(f.created_at)}>Added {formatRelative(f.created_at)}</span>
                      {f.source === 'attachment' && <span>· from an e-mail</span>}
                      <ScanBadge status={f.scan_status} />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className={btnSmall} disabled={blocked} onClick={() => void download(f)} aria-label={`Download ${f.filename}`}>
                      <IconDownload className="h-3.5 w-3.5" />
                      Download
                    </button>
                    {f.previewable && !blocked && (
                      <button
                        type="button"
                        className={btnSmall}
                        aria-label={`Preview ${f.filename}`}
                        onClick={() =>
                          setPreview({
                            filename: f.filename,
                            kind: f.previewable === 'pdf' ? 'pdf' : 'image',
                            getLink: () => api.getFileDownloadLink(f.id, 'inline'),
                            onDownload: () => void download(f),
                          })
                        }
                      >
                        <IconEye className="h-3.5 w-3.5" />
                        Preview
                      </button>
                    )}
                    <button type="button" className={btnSmall} onClick={() => setRenaming(f)} aria-label={`Rename ${f.filename}`}>
                      <IconPencil className="h-3.5 w-3.5" />
                      Rename
                    </button>
                    <button type="button" className={cx(btnSmall, 'text-red-700 dark:text-red-300')} onClick={() => setDeleting(f)} aria-label={`Delete ${f.filename}`}>
                      <IconTrash className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <PromptDialog
        open={!!renaming}
        title="Rename file"
        label="File name"
        initialValue={renaming?.filename ?? ''}
        confirmLabel="Rename"
        onClose={() => setRenaming(null)}
        onSubmit={async (name) => {
          if (!renaming) return;
          const updated = await api.renameFile(renaming.id, name);
          setFiles((fs) => (fs ? fs.map((x) => (x.id === updated.id ? updated : x)) : fs));
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete file?"
        confirmLabel="Delete"
        danger
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await api.deleteFile(deleting.id);
          setFiles((fs) => (fs ? fs.filter((x) => x.id !== deleting.id) : fs));
          void session.refresh();
          toast(`Deleted "${deleting.filename}".`, 'success');
        }}
      >
        <p>
          <strong className="break-all">{deleting?.filename}</strong> will be permanently deleted. This cannot be undone.
        </p>
      </ConfirmDialog>
      <PreviewModal request={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
