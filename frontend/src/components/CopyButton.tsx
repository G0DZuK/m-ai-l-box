import { useEffect, useRef, useState } from 'react';
import { copyText } from '../lib/download';
import { cx } from '../lib/cx';
import { IconCheck, IconCopy } from './Icons';
import { btnSmall, iconBtnSm } from './ui';

interface CopyButtonProps {
  text: string;
  /** Visible label; omit for an icon-only button. */
  label?: string;
  /** Accessible description of what is copied, e.g. "Copy e-mail address". */
  ariaLabel?: string;
  className?: string;
  variant?: 'small' | 'icon' | 'custom';
}

/** Copy-to-clipboard button with "Copied!" feedback announced via aria-live. */
export function CopyButton({ text, label, ariaLabel, className, variant = 'small' }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<number>(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onClick = async () => {
    const ok = await copyText(text);
    setState(ok ? 'copied' : 'failed');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), 2000);
  };

  const base = variant === 'icon' ? iconBtnSm : variant === 'small' ? btnSmall : '';
  const feedback = state === 'copied' ? 'Copied!' : state === 'failed' ? 'Copy failed' : '';

  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        onClick={() => void onClick()}
        className={cx(base, className)}
        aria-label={ariaLabel ?? (label ? undefined : 'Copy')}
        title={ariaLabel ?? label ?? 'Copy'}
      >
        {state === 'copied' ? <IconCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <IconCopy className="h-4 w-4" />}
        {label && variant !== 'icon' && <span>{state === 'copied' ? 'Copied!' : label}</span>}
      </button>
      <span className="sr-only" aria-live="polite" role="status">
        {feedback}
      </span>
      {variant === 'icon' && state !== 'idle' && (
        <span aria-hidden="true" className="ml-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          {feedback}
        </span>
      )}
    </span>
  );
}
