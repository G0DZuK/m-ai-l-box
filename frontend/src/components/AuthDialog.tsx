import { useEffect, useState } from 'react';
import { ApiError, errorMessage } from '../api/client';
import { useConfig } from '../context/ConfigContext';
import { useSession } from '../context/SessionContext';
import { useToast } from '../context/ToastContext';
import { cx } from '../lib/cx';
import { ErrorBanner } from './Feedback';
import { Modal } from './Modal';
import { btnPrimary, btnSecondary, focusRing, hint, input, label } from './ui';

export type AuthMode = 'signin' | 'register';

export function AuthDialog({ mode, onClose, onModeChange }: { mode: AuthMode | null; onClose: () => void; onModeChange: (m: AuthMode) => void }) {
  const config = useConfig();
  const session = useSession();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setPassword('');
  }, [mode]);

  if (!mode) return null;
  const isRegister = mode === 'register' && config.registration_open;
  const tooShort = isRegister && password.length > 0 && password.length < 10;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRegister && password.length < 10) {
      setError('Please choose a password with at least 10 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (isRegister) {
        await session.register(email.trim(), password);
        toast('Account created. You are signed in.', 'success');
      } else {
        await session.signIn(email.trim(), password);
        toast('Signed in.', 'success');
      }
      setEmail('');
      setPassword('');
      onClose();
    } catch (err) {
      if (!isRegister && err instanceof ApiError && (err.status === 401 || err.status === 400)) {
        setError('That e-mail and password do not match an account.');
      } else if (isRegister && err instanceof ApiError && err.status === 409) {
        setError('An account with this e-mail already exists. Try signing in instead.');
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const tab = (m: AuthMode, text: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => onModeChange(m)}
      className={cx(
        'flex-1 rounded-md px-3 py-1.5 text-sm font-medium',
        focusRing,
        mode === m ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white' : 'text-slate-600 hover:text-slate-900 dark:text-slate-300',
      )}
    >
      {text}
    </button>
  );

  return (
    <Modal open onClose={onClose} title={isRegister ? 'Create an account' : 'Sign in'} size="sm" dismissible={!busy}>
      {config.registration_open && (
        <div role="tablist" aria-label="Sign in or create account" className="mb-4 flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {tab('signin', 'Sign in')}
          {tab('register', 'Create account')}
        </div>
      )}
      <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
        <div>
          <label htmlFor="auth-email" className={label}>
            E-mail
          </label>
          <input
            id="auth-email"
            type="email"
            className={input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            data-autofocus
          />
        </div>
        <div>
          <label htmlFor="auth-password" className={label}>
            Password
          </label>
          <input
            id="auth-password"
            type="password"
            className={input}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            minLength={isRegister ? 10 : undefined}
            aria-invalid={tooShort}
            aria-describedby={isRegister ? 'auth-password-hint' : undefined}
            required
          />
          {isRegister && (
            <p id="auth-password-hint" className={tooShort ? 'mt-1 text-xs text-red-700 dark:text-red-300' : hint}>
              At least 10 characters.
            </p>
          )}
        </div>
        {isRegister && (
          <p className="text-xs text-slate-600 dark:text-slate-400">
            An account lets you save mailboxes so they never expire, store files and create API keys for automated tests.
          </p>
        )}
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={busy || !email.trim() || !password}>
            {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
