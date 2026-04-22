import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setAccessToken } from "../api/client";

import { Register } from "./Register";

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Register />
    </MemoryRouter>,
  );
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setAccessToken(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccessToken(null);
});

describe("Register", () => {
  it("renders a Card with email + password + invitation token inputs (no ?invite)", () => {
    renderAt("/register");
    const cardTitle = document.querySelector('[data-slot="card-title"]');
    expect(cardTitle).toHaveTextContent(/create account/i);
    expect(screen.getByLabelText(/email/i)).toHaveAttribute("type", "email");
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute("type", "password");
    expect(screen.getByLabelText(/invitation token/i)).toBeInTheDocument();
    expect(screen.queryByTestId("invite-banner")).not.toBeInTheDocument();
    expect(screen.queryByTestId("invite-token-hidden")).not.toBeInTheDocument();
  });

  it("pre-fills invite token from ?invite= URL param and hides the token input", () => {
    renderAt("/register?invite=abc123");

    // Banner visible
    expect(screen.getByTestId("invite-banner")).toBeInTheDocument();
    expect(screen.getByText(/you've been invited to join/i)).toBeInTheDocument();

    // Token field is not visible to users
    expect(screen.queryByLabelText(/invitation token/i)).not.toBeInTheDocument();

    // But a hidden input with the value exists
    const hidden = screen.getByTestId("invite-token-hidden");
    expect(hidden).toHaveAttribute("type", "hidden");
    expect(hidden).toHaveValue("abc123");
  });

  it("shows FormMessage errors on invalid submit (email + short password)", async () => {
    const user = userEvent.setup();
    renderAt("/register");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument();
    expect(await screen.findByText(/password must be at least 12 characters/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits invite token from URL when present", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    renderAt("/register?invite=xyz-987");
    await user.type(screen.getByLabelText(/email/i), "invitee@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "hunter22-long-enough");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const call = fetchMock.mock.calls[0]!;
    const url = call[0];
    const init = call[1];
    const urlString = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    expect(urlString).toBe("/api/auth/register");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string) as {
      email: string;
      password: string;
      invitationToken?: string;
    };
    expect(body.email).toBe("invitee@example.com");
    expect(body.invitationToken).toBe("xyz-987");
  });

  it("surfaces invite_required error from the backend via destructive Alert", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "invite_required" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );

    renderAt("/register");
    await user.type(screen.getByLabelText(/email/i), "stranger@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "hunter22-long-enough");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/registration failed/i);
    expect(alert).toHaveTextContent(/requires a valid invitation/i);
  });

  it("surfaces invalid_invite error with friendly copy", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_invite" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );

    renderAt("/register?invite=stale");
    await user.type(screen.getByLabelText(/email/i), "who@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "hunter22-long-enough");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(
      await screen.findByText(/invitation is invalid, expired, or already used/i),
    ).toBeInTheDocument();
  });
});
