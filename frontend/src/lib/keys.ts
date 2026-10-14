import { isModalOpen } from '../components/Modal';

/** True when a keyboard shortcut should be ignored (typing in a field, modal open, modifier held). */
export function shouldIgnoreShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return true;
  const t = e.target as HTMLElement | null;
  if (t) {
    const tag = t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return true;
    if (t.closest('[role="menu"]')) return true;
  }
  return isModalOpen();
}
