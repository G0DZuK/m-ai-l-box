import { Modal } from './Modal';

const SHORTCUTS: Array<[string[], string]> = [
  [['j'], 'Next message'],
  [['k'], 'Previous message'],
  [['Enter', 'o'], 'Open message'],
  [['u', 'Esc'], 'Back to the list'],
  [['s'], 'Star / unstar'],
  [['#', 'Delete'], 'Move to Trash'],
  [['Shift', 'I'], 'Mark as read'],
  [['Shift', 'U'], 'Mark as unread'],
  [['/'], 'Search'],
  [['r'], 'Refresh'],
  [['c'], 'Create a new mailbox'],
  [['?'], 'Show this help'],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts" description="Shortcuts are ignored while you are typing in a field." size="sm">
      <table className="w-full text-sm">
        <caption className="sr-only">Keyboard shortcuts</caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Keys</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map(([keys, desc]) => (
            <tr key={desc} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
              <td className="py-2 pr-4 whitespace-nowrap">
                {keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 && <span className="mx-1 text-slate-500">{keys[0] === 'Shift' ? '+' : 'or'}</span>}
                    <kbd className="rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-800">
                      {k}
                    </kbd>
                  </span>
                ))}
              </td>
              <td className="py-2">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
