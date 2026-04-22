import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { InvitationRecord } from "../../api/client";

import { InvitationsTable } from "./InvitationsTable";

function mkRow(overrides: Partial<InvitationRecord>): InvitationRecord {
  return {
    id: "inv-" + (overrides.id ?? "default"),
    email: "someone@example.com",
    expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    usedAt: null,
    createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

describe("InvitationsTable", () => {
  it("renders all column headers", () => {
    render(<InvitationsTable rows={[]} />);
    const headers = screen.getAllByRole("columnheader");
    const labels = headers.map((h) => h.textContent);
    expect(labels).toEqual(
      expect.arrayContaining(["Email", "Status", "Expires", "Created", "Actions"]),
    );
  });

  it("renders the empty state when the list is empty", () => {
    render(<InvitationsTable rows={[]} />);
    expect(screen.getByText(/no invitations yet/i)).toBeInTheDocument();
  });

  it("renders a Pending badge for unused, unexpired invitations", () => {
    const now = new Date("2026-04-21T12:00:00Z");
    const row = mkRow({
      id: "1",
      email: "alice@example.com",
      expiresAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      usedAt: null,
    });
    render(<InvitationsTable rows={[row]} now={now} />);
    const row1 = screen.getByRole("row", { name: /alice@example\.com/ });
    expect(within(row1).getByText(/^pending$/i)).toBeInTheDocument();
  });

  it("renders a Used badge when usedAt is set", () => {
    const now = new Date("2026-04-21T12:00:00Z");
    const row = mkRow({
      id: "2",
      email: "bob@example.com",
      usedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    });
    render(<InvitationsTable rows={[row]} now={now} />);
    const row2 = screen.getByRole("row", { name: /bob@example\.com/ });
    expect(within(row2).getByText(/^used$/i)).toBeInTheDocument();
  });

  it("renders an Expired badge when expiresAt is in the past and unused", () => {
    const now = new Date("2026-04-21T12:00:00Z");
    const row = mkRow({
      id: "3",
      email: "carol@example.com",
      expiresAt: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      usedAt: null,
    });
    render(<InvitationsTable rows={[row]} now={now} />);
    const row3 = screen.getByRole("row", { name: /carol@example\.com/ });
    expect(within(row3).getByText(/^expired$/i)).toBeInTheDocument();
  });

  it("renders an actions trigger button for each row", () => {
    render(
      <InvitationsTable
        rows={[mkRow({ id: "a" }), mkRow({ id: "b", email: "two@example.com" })]}
      />,
    );
    const triggers = screen.getAllByRole("button", { name: /row actions/i });
    expect(triggers).toHaveLength(2);
  });
});
