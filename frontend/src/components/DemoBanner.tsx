import { IconAlert } from './Icons';

/** Unmistakable label for demo mailboxes and sample messages. */
export function DemoBanner() {
  return (
    <div
      role="note"
      className="flex items-start gap-3 border-y-2 border-fuchsia-500 bg-fuchsia-50 px-4 py-2.5 text-sm text-fuchsia-950 dark:border-fuchsia-400 dark:bg-fuchsia-950/60 dark:text-fuchsia-50"
    >
      <IconAlert className="mt-0.5 h-5 w-5 shrink-0" />
      <p>
        <strong className="font-extrabold tracking-wide">DEMO MODE</strong> — these are sample messages generated locally. They are not real
        deliveries and do not prove that email delivery works.
      </p>
    </div>
  );
}
