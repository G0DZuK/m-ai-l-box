// Minimal server-sent-events reader over fetch() streaming.
// EventSource cannot send custom headers, and credentials must stay in headers.

export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

export class SseHttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`Event stream request failed (${status})`);
    this.status = status;
  }
}

/** Incremental parser for the text/event-stream format. */
export class SseParser {
  private buffer = '';
  private eventName = '';
  private dataLines: string[] = [];
  private lastId: string | undefined;
  private readonly onEvent: (e: SseEvent) => void;

  constructor(onEvent: (e: SseEvent) => void) {
    this.onEvent = onEvent;
  }

  push(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const idx = this.buffer.search(/\r\n|\r|\n/);
      if (idx === -1) break;
      // A trailing lone \r may be the first half of \r\n: wait for more data.
      if (this.buffer[idx] === '\r' && idx + 1 === this.buffer.length) break;
      const sepLen = this.buffer.startsWith('\r\n', idx) ? 2 : 1;
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + sepLen);
      this.line(line);
    }
  }

  private line(line: string): void {
    if (line === '') {
      this.dispatch();
      return;
    }
    if (line.startsWith(':')) return; // comment / keep-alive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.eventName = value;
    else if (field === 'data') this.dataLines.push(value);
    else if (field === 'id') this.lastId = value;
    // "retry" and unknown fields are ignored
  }

  private dispatch(): void {
    if (this.dataLines.length === 0 && !this.eventName) return;
    const ev: SseEvent = { event: this.eventName || 'message', data: this.dataLines.join('\n'), id: this.lastId };
    this.eventName = '';
    this.dataLines = [];
    this.onEvent(ev);
  }
}

/**
 * Open an event stream and feed events to `onEvent` until the stream ends,
 * errors, or `signal` aborts. `onOpen` runs once the response headers arrive.
 */
export async function readEventStream(
  url: string,
  headers: Record<string, string>,
  onEvent: (e: SseEvent) => void,
  signal: AbortSignal,
  onOpen?: () => void,
): Promise<void> {
  const res = await fetch(url, {
    headers: { ...headers, Accept: 'text/event-stream' },
    signal,
    cache: 'no-store',
    credentials: 'same-origin',
    referrerPolicy: 'no-referrer',
  });
  if (!res.ok) throw new SseHttpError(res.status);
  if (!res.body) throw new Error('Streaming is not supported by this browser');
  onOpen?.();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser(onEvent);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) parser.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}
