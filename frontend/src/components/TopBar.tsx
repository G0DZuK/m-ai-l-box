import { useEffect, useRef, useState, type RefObject } from 'react';
import { useConfig } from '../context/ConfigContext';
import { useMailboxes } from '../context/MailboxContext';
import { useSession } from '../context/SessionContext';
import { useTheme } from '../context/ThemeContext';
import { useUi } from '../context/UiContext';
import type { LiveStatus } from '../hooks/useLiveUpdates';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useNow } from '../hooks/useNow';
import { cx } from '../lib/cx';
import { expiryInfo, formatBytes, formatFull } from '../lib/format';
import { advancedCount, EMPTY_SEARCH, type SearchState } from '../views/search';
import { CopyButton } from './CopyButton';
import { UsageBar } from './Feedback';
import { IconFilter, IconHelp, IconLogOut, IconMenu, IconMoon, IconRefresh, IconSearch, IconShield, IconSun, IconUser, IconX, IconFolder, IconKey } from './Icons';
import { MailboxSettingsMenu } from './MailboxSettingsMenu';
import { Menu, type MenuItem } from './Menu';
import { SearchPanel } from './SearchPanel';
import { btnPrimary, btnSmall, focusRing, iconBtn } from './ui';

interface TopBarProps {
  onOpenDrawer: () => void;
  search: SearchState;
  onSearch: (s: SearchState) => void;
  searchInputRef: RefObject<HTMLInputElement>;
  onRefresh: () => void;
  refreshing: boolean;
  liveStatus: LiveStatus;
}

export function TopBar({ onOpenDrawer, search, onSearch, searchInputRef, onRefresh, refreshing, liveStatus }: TopBarProps) {
  const config = useConfig();
  const { theme, toggle } = useTheme();
  const ui = useUi();
  const [q, setQ] = useState(search.q);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const mobileWrapRef = useRef<HTMLDivElement>(null);
  const isDesktop = useMediaQuery('(min-width: 768px)');

  useEffect(() => setQ(search.q), [search.q]);

  // Debounce typing in the quick search box.
  useEffect(() => {
    if (q === search.q) return;
    const t = window.setTimeout(() => onSearch({ ...search, q }), 350);
    return () => window.clearTimeout(t);
  }, [q, search, onSearch]);

  useEffect(() => {
    if (!advancedOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (searchWrapRef.current?.contains(t) || mobileWrapRef.current?.contains(t)) return;
      setAdvancedOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [advancedOpen]);

  const adv = advancedCount(search);

  return (
    <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-2 px-2 py-2 sm:px-3">
        <button type="button" className={cx(iconBtn, 'lg:hidden')} onClick={onOpenDrawer} aria-label="Open navigation menu">
          <IconMenu />
        </button>
        <div className="hidden min-w-0 shrink-0 flex-col pr-2 sm:flex lg:w-56">
          <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">{config.app_name || 'M-Ai-L Box'}</span>
          {config.tagline && <span className="hidden truncate text-[11px] text-slate-600 dark:text-slate-400 md:block">{config.tagline}</span>}
        </div>
        <span className="text-base font-bold text-slate-900 dark:text-white sm:hidden">{config.app_name || 'M-Ai-L Box'}</span>

        <div ref={searchWrapRef} className="relative ml-auto hidden max-w-2xl flex-1 md:ml-0 md:block">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              onSearch({ ...search, q });
            }}
            className="flex items-center rounded-full bg-slate-100 pl-3 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-500 dark:bg-slate-800 dark:focus-within:bg-slate-900"
          >
            <IconSearch className="h-5 w-5 shrink-0 text-slate-500 dark:text-slate-400" />
            <label htmlFor="mail-search" className="sr-only">
              Search mail
            </label>
            <input
              ref={searchInputRef}
              id="mail-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.currentTarget.blur();
                }
              }}
              placeholder="Search mail  ( / )"
              className="h-10 min-w-0 flex-1 border-0 bg-transparent px-3 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-400"
              autoComplete="off"
            />
            {(q || adv > 0) && (
              <button
                type="button"
                className={iconBtn}
                aria-label="Clear search"
                onClick={() => {
                  setQ('');
                  onSearch(EMPTY_SEARCH);
                }}
              >
                <IconX className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              className={cx(iconBtn, 'relative mr-1')}
              aria-label="Advanced search"
              aria-expanded={advancedOpen}
              title="Advanced search"
              onClick={() => setAdvancedOpen((o) => !o)}
            >
              <IconFilter className="h-5 w-5" />
              {adv > 0 && (
                <span className="absolute -right-0.5 -top-0.5 rounded-full bg-indigo-600 px-1 text-[10px] font-bold text-white dark:bg-indigo-400 dark:text-slate-950">
                  {adv}
                </span>
              )}
            </button>
          </form>
          {advancedOpen && isDesktop && (
            <div>
              <SearchPanel value={{ ...search, q }} onApply={onSearch} onClose={() => setAdvancedOpen(false)} />
            </div>
          )}
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          <LiveIndicator status={liveStatus} />
          <button type="button" className={iconBtn} onClick={onRefresh} aria-label="Refresh (r)" title="Refresh (r)" disabled={refreshing}>
            <IconRefresh className={cx('h-5 w-5', refreshing && 'motion-safe:animate-spin')} />
          </button>
          <button
            type="button"
            className={iconBtn}
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
          <button type="button" className={cx(iconBtn, 'hidden sm:inline-flex')} onClick={ui.openHelp} aria-label="How mailboxes work" title="Help">
            <IconHelp />
          </button>
          <AccountMenu />
        </div>
      </div>

      {/* Mobile search row */}
      <div ref={mobileWrapRef} className="relative px-2 pb-2 md:hidden">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            onSearch({ ...search, q });
          }}
          className="flex items-center rounded-full bg-slate-100 pl-3 focus-within:ring-2 focus-within:ring-indigo-500 dark:bg-slate-800"
        >
          <IconSearch className="h-4 w-4 shrink-0 text-slate-500" />
          <label htmlFor="mail-search-mobile" className="sr-only">
            Search mail
          </label>
          <input
            id="mail-search-mobile"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search mail"
            className="h-9 min-w-0 flex-1 border-0 bg-transparent px-2 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-0 dark:text-slate-100"
            autoComplete="off"
          />
          <button
            type="button"
            className={iconBtn}
            aria-label="Advanced search"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((o) => !o)}
          >
            <IconFilter className="h-4 w-4" />
          </button>
        </form>
        {advancedOpen && !isDesktop && (
          <div>
            <SearchPanel value={{ ...search, q }} onApply={onSearch} onClose={() => setAdvancedOpen(false)} />
          </div>
        )}
      </div>

      <ActiveAddressBar />
    </header>
  );
}

function LiveIndicator({ status }: { status: LiveStatus }) {
  if (status === 'idle') return null;
  const text =
    status === 'live'
      ? 'Live: new mail appears automatically'
      : status === 'polling'
        ? 'Live updates unavailable: checking every 15 seconds'
        : status === 'connecting'
          ? 'Connecting for live updates…'
          : 'Reconnecting live updates…';
  const dot = status === 'live' ? 'bg-emerald-500' : status === 'polling' ? 'bg-amber-500' : 'bg-slate-400 motion-safe:animate-pulse';
  return (
    <span className="mr-1 hidden items-center gap-1.5 rounded-full px-2 py-1 text-xs text-slate-600 dark:text-slate-400 lg:inline-flex" title={text}>
      <span className={cx('h-2 w-2 rounded-full', dot)} aria-hidden="true" />
      <span>{status === 'live' ? 'Live' : status === 'polling' ? 'Polling' : 'Connecting'}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

function ActiveAddressBar() {
  const config = useConfig();
  const { active } = useMailboxes();
  const now = useNow(30_000);
  const ui = useUi();
  if (!active) return null;
  const exp = expiryInfo(active.expires_at, now);
  const retention = active.saved
    ? config.saved_message_retention_days > 0
      ? `Saved to your account · messages kept ${config.saved_message_retention_days} days`
      : 'Saved to your account · messages kept until you delete them'
    : `Temporary mailbox · deleted with all messages when it expires`;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/40 sm:px-4">
      <div className="flex min-w-0 max-w-full items-center gap-2">
        <span className="sr-only">Active address:</span>
        <span
          className={cx(
            'min-w-0 truncate font-mono text-base font-semibold sm:text-lg',
            active.gone ? 'text-slate-500 line-through' : 'text-slate-900 dark:text-white',
          )}
          title={active.address}
        >
          {active.address}
        </span>
        <CopyButton text={active.address} label="Copy" ariaLabel="Copy e-mail address" />
        <MailboxSettingsMenu key={active.id} mailbox={active} />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600 dark:text-slate-400">
        {active.label && <span className="font-medium text-slate-800 dark:text-slate-200">{active.label}</span>}
        {active.gone ? (
          <span className="font-semibold text-red-700 dark:text-red-300">Expired or removed</span>
        ) : active.saved ? (
          <span>No expiry</span>
        ) : (
          <span
            className={cx(exp.soon || exp.expired ? 'font-semibold text-amber-800 dark:text-amber-300' : undefined)}
            title={active.expires_at ? `Expires ${formatFull(active.expires_at)}` : undefined}
          >
            {exp.text}
          </span>
        )}
        <span className="hidden sm:inline">{retention}</span>
        <span className="hidden md:inline">Trash emptied after {config.trash_retention_days} days</span>
        {active.is_demo && <span className="font-semibold text-fuchsia-700 dark:text-fuchsia-300">Demo mailbox</span>}
        <button type="button" className={cx('rounded text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300', focusRing)} onClick={ui.openHelp}>
          How it works
        </button>
      </div>
    </div>
  );
}

function AccountMenu() {
  const config = useConfig();
  const session = useSession();
  const ui = useUi();
  if (!config.accounts_enabled) return null;

  if (!session.signedIn) {
    return (
      <div className="ml-1 flex items-center gap-1">
        <button type="button" className={cx(btnPrimary, 'px-3 py-1.5')} onClick={() => ui.openAuth('signin')}>
          Sign in
        </button>
        {config.registration_open && (
          <button type="button" className={cx(btnSmall, 'hidden py-1.5 sm:inline-flex')} onClick={() => ui.openAuth('register')}>
            Create account
          </button>
        )}
      </div>
    );
  }

  const usage = session.usage;
  const items: Array<MenuItem | 'separator'> = [
    { label: 'Account', icon: <IconUser className="h-4 w-4" />, onSelect: () => ui.navigate('account') },
    { label: 'My files', icon: <IconFolder className="h-4 w-4" />, onSelect: () => ui.navigate('files') },
    { label: 'API keys', icon: <IconKey className="h-4 w-4" />, onSelect: () => ui.navigate('api-keys') },
  ];
  if (session.isAdmin) items.push({ label: 'Admin', icon: <IconShield className="h-4 w-4" />, onSelect: () => ui.navigate('admin') });
  items.push('separator', { label: 'Sign out', icon: <IconLogOut className="h-4 w-4" />, onSelect: () => void session.signOut() });

  const initial = (session.user?.email || '?').charAt(0).toUpperCase();

  return (
    <Menu
      triggerLabel={`Account menu for ${session.user?.email ?? ''}`}
      triggerClassName={cx('ml-1 inline-flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-sm font-bold text-white dark:bg-indigo-400 dark:text-slate-950', focusRing)}
      trigger={<span aria-hidden="true">{initial}</span>}
      items={items}
      header={
        <div className="space-y-2">
          <div className="truncate text-sm font-medium text-slate-900 dark:text-white">{session.user?.email}</div>
          {usage && (
            <UsageBar
              used={usage.used_bytes}
              quota={usage.quota_bytes}
              label={`${formatBytes(usage.used_bytes)} of ${formatBytes(usage.quota_bytes)} used`}
            />
          )}
        </div>
      }
    />
  );
}
