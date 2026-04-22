import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type JSX, type ReactNode, useState } from "react";
import type * as SonnerModule from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setAccessToken } from "../../api/client";

import { InviteMemberDialog } from "./InviteMemberDialog";

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

function Providers({ children }: { children: ReactNode }): JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function Harness({ onOpenChangeSpy }: { onOpenChangeSpy?: (open: boolean) => void }): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <InviteMemberDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChangeSpy?.(next);
        setOpen(next);
      }}
    />
  );
}

function renderDialog(): { onOpenChange: ReturnType<typeof vi.fn> } {
  const onOpenChange = vi.fn();
  render(
    <Providers>
      <Harness onOpenChangeSpy={onOpenChange} />
    </Providers>,
  );
  return { onOpenChange };
}

const fetchMock = vi.fn<typeof fetch>();
const clipboardWrite = vi.fn<(text: string) => Promise<void>>();

// Stubbed clipboard object; reinstalled in each `beforeEach` in case jsdom or
// a prior test mutates it.
const stubbedClipboard = {
  writeText: (text: string) => clipboardWrite(text),
  readText: (): Promise<string> => Promise.resolve(""),
  read: (): Promise<ClipboardItems> => Promise.resolve([]),
  write: (): Promise<void> => Promise.resolve(),
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
};

beforeEach(() => {
  fetchMock.mockReset();
  clipboardWrite.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setAccessToken("test-token");
  // jsdom 29 exposes `navigator.clipboard` via a non-enumerable internal slot
  // that doesn't appear in the prototype chain. The only reliable override in
  // this environment is `delete nav.clipboard; nav.clipboard = …`.
  const nav = window.navigator as unknown as { clipboard: unknown };
  delete nav.clipboard;
  nav.clipboard = stubbedClipboard;
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe("InviteMemberDialog", () => {
  it("renders the form with email input and expires-in Select", () => {
    renderDialog();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toHaveAttribute("type", "email");
    expect(screen.getByRole("combobox", { name: /expires in/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send invite/i })).toBeInTheDocument();
  });

  it("shows a FormMessage on invalid email submit and does not POST", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText(/email/i), "not-an-email");
    await user.click(screen.getByRole("button", { name: /send invite/i }));
    expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs /api/invitations on valid submit and shows the success state with invite URL", async () => {
    const user = userEvent.setup();
    const token = "raw-invite-token-xyz";
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "inv-1",
          email: "invitee@example.com",
          expiresAt: "2026-05-01T10:00:00Z",
          createdAt: "2026-04-24T10:00:00Z",
          token,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );

    renderDialog();
    await user.type(screen.getByLabelText(/email/i), "invitee@example.com");
    await user.click(screen.getByRole("button", { name: /send invite/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const call = fetchMock.mock.calls[0]!;
    const url = call[0];
    const init = call[1];
    const urlString = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    expect(urlString).toBe("/api/invitations");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string) as {
      email: string;
      expiresInDays: number;
    };
    expect(body.email).toBe("invitee@example.com");
    expect(body.expiresInDays).toBe(7);

    // Success state
    expect(await screen.findByText(/invite created/i)).toBeInTheDocument();
    expect(
      screen.getByText(/copy this link and send it to invitee@example.com/i),
    ).toBeInTheDocument();
    const linkInput = screen.getByLabelText(/invite link/i);
    const linkValue = linkInput.getAttribute("value") ?? "";
    expect(linkValue).toContain(`/register?invite=${token}`);
  });

  it("copies the invite link to the clipboard when the Copy button is clicked", async () => {
    // `userEvent.setup()` replaces navigator.clipboard by default — opt out so
    // our own stub remains observable.
    const user = userEvent.setup({ writeToClipboard: false });
    const token = "copy-me-token";
    clipboardWrite.mockResolvedValue(undefined);
    // Reinstall the stub after userEvent.setup has run.
    const nav = window.navigator as unknown as { clipboard: unknown };
    delete nav.clipboard;
    nav.clipboard = stubbedClipboard;
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "inv-2",
          email: "copy@example.com",
          expiresAt: "2026-05-01T10:00:00Z",
          createdAt: "2026-04-24T10:00:00Z",
          token,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );

    renderDialog();
    await user.type(screen.getByLabelText(/email/i), "copy@example.com");
    await user.click(screen.getByRole("button", { name: /send invite/i }));
    await screen.findByText(/invite created/i);

    const btn = screen.getByRole("button", { name: /copy link/i });
    (btn as HTMLButtonElement).click();

    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledTimes(1);
    });
    expect(clipboardWrite.mock.calls[0]![0]).toContain(`/register?invite=${token}`);
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("Invite link copied");
    });
  });

  it("surfaces a 429 rate-limit error via a destructive Alert", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );

    renderDialog();
    await user.type(screen.getByLabelText(/email/i), "rate@example.com");
    await user.click(screen.getByRole("button", { name: /send invite/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/rate limit reached/i);
    expect(alert).toHaveTextContent(/try again in an hour/i);
    // Should stay on the form (not transition to success)
    expect(screen.queryByText(/invite created/i)).not.toBeInTheDocument();
  });

  it("Close button in success state calls onOpenChange(false)", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "inv-3",
          email: "close@example.com",
          expiresAt: "2026-05-01T10:00:00Z",
          createdAt: "2026-04-24T10:00:00Z",
          token: "tok",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );

    const { onOpenChange } = renderDialog();
    await user.type(screen.getByLabelText(/email/i), "close@example.com");
    await user.click(screen.getByRole("button", { name: /send invite/i }));
    await screen.findByText(/invite created/i);

    // There are two "Close" affordances: the Radix X icon in the top-right and
    // the outline footer button. Pick the footer button (the visible one).
    const closeButtons = screen.getAllByRole("button", { name: /^close$/i });
    const footerClose = closeButtons.find((b) => b.getAttribute("data-slot") !== "dialog-close");
    expect(footerClose).toBeDefined();
    await user.click(footerClose!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
