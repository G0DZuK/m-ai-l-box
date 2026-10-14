import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { KEYS, readString, writeString } from '../lib/storage';

export type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Light is the default; dark only when the user picked it.
  const [theme, setTheme] = useState<Theme>(() => (readString(KEYS.theme) === 'dark' ? 'dark' : 'light'));

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    writeString(KEYS.theme, theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
