import { render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { describe, expect, it } from "vitest";

import { Toaster } from "./sonner";

describe("Toaster (sonner)", () => {
  it("mounts and renders programmatic toast in the DOM", async () => {
    render(<Toaster />);
    toast.success("hello world");

    expect(await screen.findByText(/hello world/i)).toBeInTheDocument();
  });

  it("renders multiple toasts", async () => {
    render(<Toaster />);
    toast("first");
    toast("second");

    expect(await screen.findByText(/first/i)).toBeInTheDocument();
    expect(await screen.findByText(/second/i)).toBeInTheDocument();
  });
});
