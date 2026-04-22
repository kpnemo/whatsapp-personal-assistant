import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider, useTheme } from "./theme-provider";
import { ThemeToggle } from "./theme-toggle";

type MatchMediaListener = (event: { matches: boolean; media: string }) => void;

function installMatchMediaMock(initialDark = false): void {
  const listeners = new Set<MatchMediaListener>();
  const mql = {
    matches: initialDark,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: "change", cb: MatchMediaListener) => {
      listeners.add(cb);
    },
    removeEventListener: (_type: "change", cb: MatchMediaListener) => {
      listeners.delete(cb);
    },
    addListener: (cb: MatchMediaListener) => {
      listeners.add(cb);
    },
    removeListener: (cb: MatchMediaListener) => {
      listeners.delete(cb);
    },
    dispatchEvent: () => false,
  };
  vi.spyOn(window, "matchMedia").mockImplementation(() => mql as unknown as MediaQueryList);
}

// Small probe so tests can introspect current theme alongside the toggle.
function ThemeProbe(): React.ReactElement {
  const { theme } = useTheme();
  return <span data-testid="theme-state">{theme}</span>;
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("renders a trigger button", () => {
    installMatchMediaMock(false);
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeInTheDocument();
  });

  it("opens menu on click and shows 3 options with icons", async () => {
    installMatchMediaMock(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: /toggle theme/i }));

    const light = await screen.findByRole("menuitem", { name: /light/i });
    const dark = screen.getByRole("menuitem", { name: /dark/i });
    const system = screen.getByRole("menuitem", { name: /system/i });
    expect(light).toBeInTheDocument();
    expect(dark).toBeInTheDocument();
    expect(system).toBeInTheDocument();

    // Every item should have an icon (lucide-react renders svg).
    expect(light.querySelector("svg")).toBeTruthy();
    expect(dark.querySelector("svg")).toBeTruthy();
    expect(system.querySelector("svg")).toBeTruthy();
  });

  it("marks the currently-active theme with a check indicator", async () => {
    installMatchMediaMock(false);
    const user = userEvent.setup();
    window.localStorage.setItem("wpa-theme", "dark");
    render(
      <ThemeProvider>
        <ThemeToggle />
        <ThemeProbe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: /toggle theme/i }));

    const darkItem = await screen.findByRole("menuitem", { name: /dark/i });
    expect(darkItem).toHaveAttribute("data-active", "true");

    const lightItem = screen.getByRole("menuitem", { name: /light/i });
    expect(lightItem).toHaveAttribute("data-active", "false");
  });

  it("clicking Light calls setTheme('light') and closes the menu", async () => {
    installMatchMediaMock(false);
    const user = userEvent.setup();
    window.localStorage.setItem("wpa-theme", "dark");
    render(
      <ThemeProvider>
        <ThemeToggle />
        <ThemeProbe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    const lightItem = await screen.findByRole("menuitem", { name: /light/i });
    await user.click(lightItem);

    expect(screen.getByTestId("theme-state")).toHaveTextContent("light");
    expect(screen.queryByRole("menuitem", { name: /light/i })).not.toBeInTheDocument();
  });

  it("clicking Dark calls setTheme('dark')", async () => {
    installMatchMediaMock(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle />
        <ThemeProbe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    const darkItem = await screen.findByRole("menuitem", { name: /dark/i });
    await user.click(darkItem);

    expect(screen.getByTestId("theme-state")).toHaveTextContent("dark");
  });

  it("clicking System calls setTheme('system')", async () => {
    installMatchMediaMock(false);
    const user = userEvent.setup();
    window.localStorage.setItem("wpa-theme", "light");
    render(
      <ThemeProvider>
        <ThemeToggle />
        <ThemeProbe />
      </ThemeProvider>,
    );

    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    const systemItem = await screen.findByRole("menuitem", { name: /system/i });
    await user.click(systemItem);

    expect(screen.getByTestId("theme-state")).toHaveTextContent("system");
    expect(window.localStorage.getItem("wpa-theme")).toBeNull();
  });
});
