import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme } from "./theme-provider";

type MatchMediaListener = (event: { matches: boolean; media: string }) => void;

interface MockMediaQueryList {
  matches: boolean;
  media: string;
  onchange: null;
  addEventListener: (type: "change", cb: MatchMediaListener) => void;
  removeEventListener: (type: "change", cb: MatchMediaListener) => void;
  addListener: (cb: MatchMediaListener) => void;
  removeListener: (cb: MatchMediaListener) => void;
  dispatchEvent: () => boolean;
  __fire: (matches: boolean) => void;
}

function installMatchMediaMock(initialDark = false): MockMediaQueryList {
  const listeners = new Set<MatchMediaListener>();
  const mql: MockMediaQueryList = {
    matches: initialDark,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type, cb) => {
      listeners.add(cb);
    },
    removeEventListener: (_type, cb) => {
      listeners.delete(cb);
    },
    addListener: (cb) => {
      listeners.add(cb);
    },
    removeListener: (cb) => {
      listeners.delete(cb);
    },
    dispatchEvent: () => false,
    __fire: (matches) => {
      mql.matches = matches;
      for (const cb of listeners) {
        cb({ matches, media: mql.media });
      }
    },
  };
  vi.spyOn(window, "matchMedia").mockImplementation(() => mql as unknown as MediaQueryList);
  return mql;
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("defaults to 'system' when no localStorage entry and reads matchMedia (light)", () => {
    installMatchMediaMock(false);
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });
    expect(result.current.theme).toBe("system");
    expect(result.current.resolvedTheme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("defaults to 'system' and resolves to 'dark' when OS prefers dark", () => {
    installMatchMediaMock(true);
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });
    expect(result.current.theme).toBe("system");
    expect(result.current.resolvedTheme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("reads persisted 'dark' theme from localStorage", () => {
    installMatchMediaMock(false);
    window.localStorage.setItem("wpa-theme", "dark");
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });
    expect(result.current.theme).toBe("dark");
    expect(result.current.resolvedTheme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("reads persisted 'light' theme from localStorage", () => {
    installMatchMediaMock(true); // OS says dark but user has override
    window.localStorage.setItem("wpa-theme", "light");
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });
    expect(result.current.theme).toBe("light");
    expect(result.current.resolvedTheme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("ignores invalid localStorage values and falls back to system", () => {
    installMatchMediaMock(false);
    window.localStorage.setItem("wpa-theme", "neon");
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });
    expect(result.current.theme).toBe("system");
  });

  it("setTheme('light') updates state, writes localStorage, removes dark class", () => {
    installMatchMediaMock(true);
    window.localStorage.setItem("wpa-theme", "dark");
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    act(() => {
      result.current.setTheme("light");
    });

    expect(result.current.theme).toBe("light");
    expect(result.current.resolvedTheme).toBe("light");
    expect(window.localStorage.getItem("wpa-theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("setTheme('dark') adds dark class and writes localStorage", () => {
    installMatchMediaMock(false);
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => {
      result.current.setTheme("dark");
    });

    expect(result.current.theme).toBe("dark");
    expect(result.current.resolvedTheme).toBe("dark");
    expect(window.localStorage.getItem("wpa-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("setTheme('system') removes localStorage entry and reacts to matchMedia change", () => {
    const mql = installMatchMediaMock(false);
    window.localStorage.setItem("wpa-theme", "dark");
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });
    expect(result.current.theme).toBe("dark");

    act(() => {
      result.current.setTheme("system");
    });

    expect(result.current.theme).toBe("system");
    expect(window.localStorage.getItem("wpa-theme")).toBeNull();
    expect(result.current.resolvedTheme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    // Fire the matchMedia change event -> resolvedTheme should update.
    act(() => {
      mql.__fire(true);
    });

    expect(result.current.resolvedTheme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    // Flip back to light.
    act(() => {
      mql.__fire(false);
    });

    expect(result.current.resolvedTheme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("does not react to matchMedia change when theme is not 'system'", () => {
    const mql = installMatchMediaMock(false);
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });

    act(() => {
      result.current.setTheme("light");
    });

    act(() => {
      mql.__fire(true); // OS switched to dark — but user pinned light.
    });

    expect(result.current.theme).toBe("light");
    expect(result.current.resolvedTheme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("tolerates localStorage throwing (private mode)", () => {
    installMatchMediaMock(false);
    const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });
    expect(result.current.theme).toBe("system");

    expect(() => {
      act(() => {
        result.current.setTheme("dark");
      });
    }).not.toThrow();
    expect(result.current.theme).toBe("dark");

    expect(() => {
      act(() => {
        result.current.setTheme("system");
      });
    }).not.toThrow();

    getSpy.mockRestore();
    setSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it("useTheme returns a safe default when called outside a provider", () => {
    installMatchMediaMock(false);
    // No provider wrapper — the hook must not throw.
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
    expect(result.current.resolvedTheme).toBe("light");
    // setTheme should be a no-op function.
    expect(() => {
      result.current.setTheme("dark");
    }).not.toThrow();
  });

  it("renders children", () => {
    installMatchMediaMock(false);
    render(
      <ThemeProvider>
        <span>hello</span>
      </ThemeProvider>,
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("cleans up matchMedia listener on unmount", () => {
    const mql = installMatchMediaMock(false);
    const removeSpy = vi.spyOn(mql, "removeEventListener");
    const { unmount } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });
    unmount();
    expect(removeSpy).toHaveBeenCalled();
  });
});
