import { useEffect, useState } from 'react';
import { EMPTY_SEARCH, type SearchState } from '../views/search';
import { btnPrimary, btnSecondary, checkbox, input, label } from './ui';

interface SearchPanelProps {
  value: SearchState;
  onApply: (s: SearchState) => void;
  onClose: () => void;
}

/** Advanced search form; every field maps to a query parameter of the message list. */
export function SearchPanel({ value, onApply, onClose }: SearchPanelProps) {
  const [draft, setDraft] = useState<SearchState>(value);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    document.getElementById('as-from')?.focus();
  }, []);

  const set = <K extends keyof SearchState>(k: K, v: SearchState[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onApply(draft);
    onClose();
  };

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      className="absolute left-0 right-0 top-full z-40 mt-1 rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900"
      aria-label="Advanced search"
      role="search"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="as-from" className={label}>From</label>
          <input id="as-from" className={input} value={draft.from} onChange={(e) => set('from', e.target.value)} placeholder="sender name or address" data-autofocus />
        </div>
        <div>
          <label htmlFor="as-to" className={label}>To</label>
          <input id="as-to" className={input} value={draft.to} onChange={(e) => set('to', e.target.value)} placeholder="recipient" />
        </div>
        <div>
          <label htmlFor="as-subject" className={label}>Subject</label>
          <input id="as-subject" className={input} value={draft.subject} onChange={(e) => set('subject', e.target.value)} />
        </div>
        <div>
          <label htmlFor="as-words" className={label}>Has the words</label>
          <input id="as-words" className={input} value={draft.q} onChange={(e) => set('q', e.target.value)} placeholder="anywhere in the message" />
        </div>
        <div>
          <label htmlFor="as-after" className={label}>Received after</label>
          <input id="as-after" type="date" className={input} value={draft.after} onChange={(e) => set('after', e.target.value)} />
        </div>
        <div>
          <label htmlFor="as-before" className={label}>Received before</label>
          <input id="as-before" type="date" className={input} value={draft.before} onChange={(e) => set('before', e.target.value)} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className={checkbox} checked={draft.unread} onChange={(e) => set('unread', e.target.checked)} />
          Unread only
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className={checkbox} checked={draft.has_attachments} onChange={(e) => set('has_attachments', e.target.checked)} />
          Has attachments
        </label>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className={btnSecondary}
          onClick={() => {
            setDraft(EMPTY_SEARCH);
            onApply(EMPTY_SEARCH);
            onClose();
          }}
        >
          Clear
        </button>
        <button type="button" className={btnSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={btnPrimary}>
          Search
        </button>
      </div>
    </form>
  );
}
