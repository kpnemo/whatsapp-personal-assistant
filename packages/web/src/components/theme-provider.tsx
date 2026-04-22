import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = "wpa-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function readStoredTheme(): Theme {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (isTheme(raw)) return raw;
  } catch {
    // private mode / disabled storage — fall through to default
  }
  return "system";
}

function writeStoredTheme(theme: Theme): void {
  try {
    if (theme === "system") {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, theme);
    }
  } catch {
    // ignore — theme will still work in-memory for this session
  }
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(DARK_QUERY).matches;
}

function applyDarkClass(isDark: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (isDark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

function resolve(theme: Theme, systemDark: boolean): ResolvedTheme {
  if (theme === "system") return systemDark ? "dark" : "light";
  return theme;
}

// Default context returned when no provider is mounted. setTheme is a no-op.
const defaultContextValue: ThemeContextValue = {
  theme: "system",
  resolvedTheme: "light",
  setTheme: () => undefined,
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());

  // Listen to OS preference changes only while theme === "system".
  useEffect(() => {
    if (theme !== "system") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mql = window.matchMedia(DARK_QUERY);
    // Sync state with current match in case it changed between mount and now.
    setSystemDark(mql.matches);

    const handleChange = (event: MediaQueryListEvent | { matches: boolean }): void => {
      setSystemDark(event.matches);
    };

    mql.addEventListener("change", handleChange);
    return () => {
      mql.removeEventListener("change", handleChange);
    };
  }, [theme]);

  const resolvedTheme = resolve(theme, systemDark);

  // Apply dark class to <html> whenever resolvedTheme changes.
  useEffect(() => {
    applyDarkClass(resolvedTheme === "dark");
  }, [resolvedTheme]);

  const setTheme = useCallback((next: Theme) => {
    writeStoredTheme(next);
    setThemeState(next);
    // Re-read system preference when flipping to "system" so resolvedTheme is fresh.
    if (next === "system") {
      setSystemDark(systemPrefersDark());
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Read the current theme state.
 *
 * If called outside a ThemeProvider, returns a safe default ({ theme: "system",
 * resolvedTheme: "light", setTheme: no-op }) rather than throwing. This keeps
 * throwaway components (e.g. Storybook, tests) renderable without ceremony.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  return ctx ?? defaultContextValue;
}
