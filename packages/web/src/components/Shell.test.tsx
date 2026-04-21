import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type * as SonnerModule from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setAccessToken } from "../api/client";
import { useAuth } from "../stores/auth";

import { Shell } from "./Shell";

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", async () => {
  const actual = await vi.importActual<typeof SonnerModule>("sonner");
  return {
    ...actual,
    toast: {
      success: (message: string) => {
        toastSuccess(message);
      },
      error: (message: string) => {
        toastError(message);
      },
    },
  };
});

function renderShell(path = "/"): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Shell>
        <div>child-content</div>
      </Shell>
    </MemoryRouter>,
  );
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setAccessToken("test-token");
  useAuth.setState({
    me: { id: "u-1", email: "user@example.com", role: "user" },
    loading: false,
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useAuth.setState({ me: null, loading: false, error: null });
  setAccessToken(null);
});

describe("Shell", () => {
  it("renders the top bar with app name, theme toggle, kill switch, and user menu", () => {
    renderShell();
    expect(screen.getByRole("heading", { name: /whatsapp personal assistant/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /kill switch/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /user menu/i })).toBeVisible();
  });

  it("renders nav items in the sidebar", () => {
    renderShell();
    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).getByRole("link", { name: /dashboard/i })).toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: /pair whatsapp/i })).toBeInTheDocument();
  });

  it("hides the Invitations nav link for non-admin users", () => {
    renderShell();
    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).queryByRole("link", { name: /invitations/i })).not.toBeInTheDocument();
  });

  it("shows the Invitations nav link with Admin badge for admin users", () => {
    useAuth.setState({
      me: { id: "admin-1", email: "admin@example.com", role: "admin" },
      loading: false,
      error: null,
    });
    renderShell();
    const sidebar = screen.getByRole("complementary");
    const inviteLink = within(sidebar).getByRole("link", { name: /invitations/i });
    expect(inviteLink).toBeInTheDocument();
    expect(within(inviteLink).getByText(/admin/i)).toBeInTheDocument();
  });

  it("opens the kill switch AlertDialog on button click (no browser alert)", async () => {
    const user = userEvent.setup();
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => undefined);

    renderShell();
    await user.click(screen.getByRole("button", { name: /kill switch/i }));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /mute the assistant globally/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/disables all ai replies/i)).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("cancel button closes the dialog without POSTing /api/kill", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: /kill switch/i }));
    await screen.findByRole("alertdialog");

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirm button POSTs /api/kill and shows success toast", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    renderShell();
    await user.click(screen.getByRole("button", { name: /kill switch/i }));
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: /^mute assistant$/i }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const call = fetchMock.mock.calls[0]!;
    const url = call[0];
    const init = call[1];
    const urlString = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    expect(urlString).toBe("/api/kill");
    expect(init?.method).toBe("POST");

    await vi.waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("Kill switch armed — assistant muted globally.");
    });
  });

  it("confirm button shows error toast on API failure", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response("server exploded", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );

    renderShell();
    await user.click(screen.getByRole("button", { name: /kill switch/i }));
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: /^mute assistant$/i }));

    await vi.waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
    const firstArg = toastError.mock.calls[0]![0] as string;
    expect(firstArg).toMatch(/failed to mute:/i);
  });

  it("user menu opens and shows email label + Sign out item", async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole("button", { name: /user menu/i }));
    expect(await screen.findByRole("menuitem", { name: /sign out/i })).toBeInTheDocument();
  });

  it("Sign out calls auth.logout() and navigates to /login", async () => {
    const user = userEvent.setup();
    const logoutSpy = vi.fn(() => {
      useAuth.setState({ me: null });
      return Promise.resolve();
    });
    useAuth.setState({
      me: { id: "u-1", email: "user@example.com", role: "user" },
      loading: false,
      error: null,
      logout: logoutSpy,
    });

    renderShell();
    await user.click(screen.getByRole("button", { name: /user menu/i }));
    await user.click(await screen.findByRole("menuitem", { name: /sign out/i }));

    await vi.waitFor(() => {
      expect(logoutSpy).toHaveBeenCalledTimes(1);
    });
  });
});
