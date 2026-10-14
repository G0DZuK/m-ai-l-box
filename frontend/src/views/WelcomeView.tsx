import { IconKey, IconMail, IconPlus, IconUser } from '../components/Icons';
import { btnPrimary, btnSecondary, card } from '../components/ui';
import { useConfig } from '../context/ConfigContext';
import { useSession } from '../context/SessionContext';
import { useUi } from '../context/UiContext';

/** Shown when this browser has no mailbox yet. */
export function WelcomeView() {
  const config = useConfig();
  const { signedIn } = useSession();
  const ui = useUi();

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-16">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-4xl">{config.app_name || 'M-Ai-L Box'}</h1>
        {config.tagline && <p className="mt-2 text-lg text-slate-700 dark:text-slate-300">{config.tagline}</p>}
        <p className="mt-4 max-w-2xl text-slate-700 dark:text-slate-300">
          Get a disposable e-mail address in one click. Use it to test sign-ups, password resets, verification codes and any other e-mail your
          app sends — then watch the messages arrive here in real time.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <button type="button" className={`${btnPrimary} px-5 py-3 text-base`} onClick={ui.openCreate}>
            <IconPlus />
            Create new mailbox
          </button>
          <button type="button" className={`${btnSecondary} px-5 py-3 text-base`} onClick={ui.openExisting}>
            <IconKey />
            Open existing mailbox
          </button>
          {config.demo_mode && (
            <button type="button" className={`${btnSecondary} px-5 py-3 text-base`} onClick={ui.startDemo}>
              <IconMail />
              Try demo mailbox
            </button>
          )}
          {config.accounts_enabled && !signedIn && (
            <button type="button" className={`${btnSecondary} px-5 py-3 text-base`} onClick={() => ui.openAuth('signin')}>
              <IconUser />
              Sign in
            </button>
          )}
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <div className={card}>
            <h2 className="font-semibold text-slate-900 dark:text-white">1. Create an address</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Random or custom. It lasts {config.temp_mailbox_ttl_hours} hours unless you save it to an account.
            </p>
          </div>
          <div className={card}>
            <h2 className="font-semibold text-slate-900 dark:text-white">2. Send mail to it</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">From your app or test suite. New messages appear automatically.</p>
          </div>
          <div className={card}>
            <h2 className="font-semibold text-slate-900 dark:text-white">3. Inspect everything</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Codes, links, headers, raw source and attachments — ready to copy.</p>
          </div>
        </div>

        <p className="mt-8 text-sm text-slate-600 dark:text-slate-400">
          Your mailbox&rsquo;s access key is kept in this browser.{' '}
          <button type="button" className="text-indigo-700 underline underline-offset-2 dark:text-indigo-300" onClick={ui.openHelp}>
            Learn how mailboxes, keys and expiry work
          </button>
          .
        </p>
      </div>
    </div>
  );
}

export function SignInPrompt({ what }: { what: string }) {
  const config = useConfig();
  const ui = useUi();
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Sign in to use {what}</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {config.accounts_enabled ? 'This feature needs an account.' : 'Accounts are turned off on this server.'}
        </p>
        {config.accounts_enabled && (
          <div className="mt-4 flex justify-center gap-2">
            <button type="button" className={btnPrimary} onClick={() => ui.openAuth('signin')}>
              Sign in
            </button>
            {config.registration_open && (
              <button type="button" className={btnSecondary} onClick={() => ui.openAuth('register')}>
                Create account
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
