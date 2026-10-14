// Download / clipboard helpers.

/** Navigate an <a download> to a (short-lived) download URL returned by the API. */
export function triggerDownload(url: string, filename?: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener noreferrer';
  a.download = filename ?? '';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => a.remove(), 0);
}

/** Save locally generated text (e.g. an access key) as a .txt file. */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
