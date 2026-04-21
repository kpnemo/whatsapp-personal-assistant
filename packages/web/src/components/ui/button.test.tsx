import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  const variants = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const;
  const sizes = ["default", "sm", "lg", "icon"] as const;

  for (const variant of variants) {
    it(`renders ${variant} variant`, () => {
      render(<Button variant={variant}>click me</Button>);
      const btn = screen.getByRole("button", { name: /click me/i });
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveAttribute("data-variant", variant);
    });
  }

  for (const size of sizes) {
    it(`renders ${size} size`, () => {
      render(<Button size={size}>X</Button>);
      const btn = screen.getByRole("button");
      expect(btn).toHaveAttribute("data-size", size);
    });
  }

  it("fires onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>press</Button>);
    await user.click(screen.getByRole("button", { name: /press/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        press
      </Button>,
    );
    await user.click(screen.getByRole("button", { name: /press/i }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("asChild renders anchor with button classes applied", () => {
    render(
      <Button asChild>
        <a href="/home">go home</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: /go home/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/home");
    expect(link.className).toMatch(/inline-flex/);
    expect(link).toHaveAttribute("data-slot", "button");
  });
});
