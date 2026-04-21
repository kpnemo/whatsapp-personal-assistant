import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "../stores/auth";

import { Login } from "./Login";

function renderLogin(): void {
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <Login />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuth.setState({ me: null, loading: false, error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  useAuth.setState({ me: null, loading: false, error: null });
});

describe("Login", () => {
  it("renders a Card with email + password inputs and a submit button", () => {
    renderLogin();
    // CardTitle renders as a <div data-slot="card-title"> not a heading.
    const cardTitle = document.querySelector('[data-slot="card-title"]');
    expect(cardTitle).toHaveTextContent(/sign in/i);
    expect(screen.getByLabelText(/email/i)).toHaveAttribute("type", "email");
    expect(screen.getByLabelText(/password/i)).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
  });

  it("surfaces zod FormMessage errors on empty submit", async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument();
    expect(await screen.findByText(/password is required/i)).toBeInTheDocument();
  });

  it("shows the server error Alert when auth store has error state", () => {
    useAuth.setState({ me: null, loading: false, error: "Invalid email or password" });
    renderLogin();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/sign in failed/i);
    expect(alert).toHaveTextContent(/invalid email or password/i);
  });

  it("calls login() on valid submit and disables the button while pending", async () => {
    const user = userEvent.setup();
    let resolveLogin: (() => void) | undefined;
    const loginSpy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLogin = resolve;
        }),
    );
    useAuth.setState({ me: null, loading: false, error: null, login: loginSpy });

    renderLogin();
    await user.type(screen.getByLabelText(/email/i), "alice@example.com");
    await user.type(screen.getByLabelText(/password/i), "secret");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await vi.waitFor(() => {
      expect(loginSpy).toHaveBeenCalledWith("alice@example.com", "secret");
    });

    // Loading indicator + disabled button while pending
    expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled();

    resolveLogin?.();
  });

  it("renders a Register link", () => {
    renderLogin();
    const link = screen.getByRole("link", { name: /register/i });
    expect(link).toHaveAttribute("href", "/register");
  });
});
