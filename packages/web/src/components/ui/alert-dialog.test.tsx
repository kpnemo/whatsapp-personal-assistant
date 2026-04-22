import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";

function Harness({
  onCancel,
  onAction,
}: {
  onCancel: () => void;
  onAction: () => void;
}): React.ReactElement {
  return (
    <AlertDialog>
      <AlertDialogTrigger>delete</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>are you sure?</AlertDialogTitle>
          <AlertDialogDescription>this is permanent.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onAction}>confirm</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

describe("AlertDialog", () => {
  it("uses role=alertdialog when open", async () => {
    const user = userEvent.setup();
    render(<Harness onCancel={vi.fn()} onAction={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /delete/i }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("fires action handler and closes", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<Harness onCancel={vi.fn()} onAction={onAction} />);
    await user.click(screen.getByRole("button", { name: /delete/i }));
    await screen.findByRole("alertdialog");

    await user.click(screen.getByRole("button", { name: /confirm/i }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("fires cancel handler and closes", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<Harness onCancel={onCancel} onAction={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /delete/i }));
    await screen.findByRole("alertdialog");

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("returns focus to trigger on close", async () => {
    const user = userEvent.setup();
    render(<Harness onCancel={vi.fn()} onAction={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /delete/i });
    await user.click(trigger);
    await screen.findByRole("alertdialog");

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(trigger).toHaveFocus();
  });
});
