import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type JSX, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

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
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

import { ApiError, pair } from "../api/client.js";

interface DisconnectDialogProps {
  /** If provided, renders as a controlled dialog; parent manages open state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** If provided, renders a trigger button. Mutually exclusive with controlled mode. */
  renderTrigger?: boolean;
}

export function DisconnectDialog({
  open,
  onOpenChange,
  renderTrigger = false,
}: DisconnectDialogProps): JSX.Element {
  const [internalOpen, setInternalOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setIsOpen = isControlled ? (onOpenChange ?? (() => undefined)) : setInternalOpen;

  const disconnectMutation = useMutation({
    mutationFn: () => pair.disconnect(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["pair-status"] });
      setIsOpen(false);
      toast.success("Disconnected successfully.");
      void navigate("/pair");
    },
    onError: (err: unknown) => {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "unknown error";
      toast.error(`Disconnect failed: ${message}`);
    },
  });

  const dialog = (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Disconnect WhatsApp?</AlertDialogTitle>
        <AlertDialogDescription>
          This will close the Baileys socket and unlink your WhatsApp session. You will need to scan
          a new QR code to reconnect.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={disconnectMutation.isPending}>Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          disabled={disconnectMutation.isPending}
          onClick={(e) => {
            e.preventDefault();
            disconnectMutation.mutate();
          }}
        >
          {disconnectMutation.isPending ? "Disconnecting…" : "Disconnect"}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );

  if (renderTrigger) {
    return (
      <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="outline" className="text-destructive" size="sm">
            Disconnect
          </Button>
        </AlertDialogTrigger>
        {dialog}
      </AlertDialog>
    );
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      {dialog}
    </AlertDialog>
  );
}
