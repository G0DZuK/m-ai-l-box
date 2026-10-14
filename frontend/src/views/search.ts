import type { MessageQuery } from '../api/types';

export interface SearchState {
  q: string;
  from: string;
  to: string;
  subject: string;
  /** yyyy-mm-dd from <input type="date"> */
  after: string;
  before: string;
  unread: boolean;
  has_attachments: boolean;
}

export const EMPTY_SEARCH: SearchState = {
  q: '',
  from: '',
  to: '',
  subject: '',
  after: '',
  before: '',
  unread: false,
  has_attachments: false,
};

export function isSearchActive(s: SearchState): boolean {
  return !!(s.q.trim() || s.from.trim() || s.to.trim() || s.subject.trim() || s.after || s.before || s.unread || s.has_attachments);
}

export function advancedCount(s: SearchState): number {
  return [s.from.trim(), s.to.trim(), s.subject.trim(), s.after, s.before, s.unread, s.has_attachments].filter(Boolean).length;
}

/** Map the search form to the message list query parameters. */
export function toQuery(s: SearchState): MessageQuery {
  return {
    q: s.q.trim() || undefined,
    from: s.from.trim() || undefined,
    to: s.to.trim() || undefined,
    subject: s.subject.trim() || undefined,
    after: s.after || undefined,
    before: s.before || undefined,
    unread: s.unread || undefined,
    has_attachments: s.has_attachments || undefined,
  };
}
