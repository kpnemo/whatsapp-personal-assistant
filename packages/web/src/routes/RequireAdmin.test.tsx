import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useAuth } from "../stores/auth";

import { RequireAdmin } from "./RequireAdmin";

function renderTree(): void {
  render(
    <MemoryRouter initialEntries={["/admin/invitations"]}>
      <Routes>
        <Route path="/" element={<div>home-page</div>} />
        <Route element={<RequireAdmin />}>
          <Route path="/admin/invitations" element={<div>admin-content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuth.setState({ me: null, loading: false, error: null });
});

afterEach(() => {
  useAuth.setState({ me: null, loading: false, error: null });
});

describe("RequireAdmin", () => {
  it("renders null while auth is still loading (delegated to RequireAuth Skeleton)", () => {
    useAuth.setState({ me: null, loading: true, error: null });
    const { container } = render(
      <MemoryRouter initialEntries={["/admin/invitations"]}>
        <Routes>
          <Route path="/" element={<div>home-page</div>} />
          <Route element={<RequireAdmin />}>
            <Route path="/admin/invitations" element={<div>admin-content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(container.textContent ?? "").toBe("");
  });

  it("redirects non-admin users to /", () => {
    useAuth.setState({
      me: { id: "u-1", email: "user@example.com", role: "user" },
      loading: false,
      error: null,
    });
    renderTree();
    expect(screen.getByText(/home-page/i)).toBeInTheDocument();
    expect(screen.queryByText(/admin-content/i)).not.toBeInTheDocument();
  });

  it("redirects unauthenticated users to /", () => {
    useAuth.setState({ me: null, loading: false, error: null });
    renderTree();
    expect(screen.getByText(/home-page/i)).toBeInTheDocument();
    expect(screen.queryByText(/admin-content/i)).not.toBeInTheDocument();
  });

  it("renders the Outlet when the user is an admin", () => {
    useAuth.setState({
      me: { id: "admin-1", email: "admin@example.com", role: "admin" },
      loading: false,
      error: null,
    });
    renderTree();
    expect(screen.getByText(/admin-content/i)).toBeInTheDocument();
    expect(screen.queryByText(/home-page/i)).not.toBeInTheDocument();
  });
});
