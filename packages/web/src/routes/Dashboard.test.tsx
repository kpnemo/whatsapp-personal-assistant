import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useAuth } from "../stores/auth";

import { Dashboard } from "./Dashboard";

function renderDashboard(): void {
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuth.setState({
    me: { id: "u-1", email: "user@example.com", role: "user" },
    loading: false,
    error: null,
  });
});

afterEach(() => {
  useAuth.setState({ me: null, loading: false, error: null });
});

describe("Dashboard", () => {
  it("renders the Welcome card with user email", () => {
    renderDashboard();
    // CardTitle renders as a <div data-slot="card-title"> not a heading.
    expect(screen.getByText(/^welcome$/i)).toBeInTheDocument();
    expect(screen.getByText(/user@example.com/i)).toBeInTheDocument();
  });

  it("renders a Pair WhatsApp CTA linking to /pair", () => {
    renderDashboard();
    expect(screen.getByText(/^pair whatsapp$/i)).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /start pairing/i });
    expect(cta).toHaveAttribute("href", "/pair");
  });

  it("renders a Recent activity card with skeleton placeholders", () => {
    renderDashboard();
    expect(screen.getByText(/^recent activity$/i)).toBeInTheDocument();
    // Skeletons get data-slot=skeleton from the primitive.
    const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });
});
