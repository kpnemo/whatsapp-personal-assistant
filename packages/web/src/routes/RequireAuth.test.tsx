import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuth } from "../stores/auth";

import { RequireAuth } from "./RequireAuth";

function renderTree(): void {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/login" element={<div>login-page</div>} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<div>protected-content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  // bootstrap() runs in useEffect; return a synchronously-resolved no-op
  // so there's no post-mount state churn that would trip act() warnings.
  useAuth.setState({
    me: null,
    loading: true,
    error: null,
    bootstrap: () => Promise.resolve(),
  });
});

afterEach(() => {
  useAuth.setState({ me: null, loading: false, error: null });
  vi.restoreAllMocks();
});

describe("RequireAuth", () => {
  it("renders a skeleton shell while auth is loading", () => {
    useAuth.setState({ me: null, loading: true, error: null });
    renderTree();

    expect(screen.getByTestId("require-auth-loading")).toBeInTheDocument();
    const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(3);
    expect(screen.queryByText(/protected-content/i)).not.toBeInTheDocument();
  });

  it("redirects to /login when unauthenticated", () => {
    useAuth.setState({ me: null, loading: false, error: null });
    renderTree();
    expect(screen.getByText(/login-page/i)).toBeInTheDocument();
    expect(screen.queryByText(/protected-content/i)).not.toBeInTheDocument();
  });

  it("renders protected outlet when authenticated", () => {
    useAuth.setState({
      me: { id: "u-1", email: "user@example.com", role: "user" },
      loading: false,
      error: null,
    });
    renderTree();
    expect(screen.getByText(/protected-content/i)).toBeInTheDocument();
    expect(screen.queryByTestId("require-auth-loading")).not.toBeInTheDocument();
  });
});
