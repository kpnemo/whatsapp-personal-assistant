import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Loader2 } from "lucide-react";
import { type JSX, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { ApiError, invitations, type InvitationCreatedResponse } from "../../api/client";

const inviteSchema = z.object({
  email: z.string().email({ message: "Enter a valid email address." }),
  expiresInDays: z.coerce
    .number()
    .int()
    .min(1, { message: "Minimum 1 day." })
    .max(30, { message: "Maximum 30 days." }),
});

type InviteValues = z.infer<typeof inviteSchema>;

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function messageForError(err: unknown): { title: string; description: string } {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return {
        title: "Rate limit reached",
        description: "You've created too many invitations recently. Try again in an hour.",
      };
    }
    if (err.status === 401 || err.status === 403) {
      return {
        title: "Session expired",
        description: "Sign out and sign back in to continue.",
      };
    }
    if (err.status === 400) {
      return {
        title: "Invalid input",
        description: "Double-check the email address and expiry window.",
      };
    }
    return { title: "Could not create invite", description: err.message };
  }
  if (err instanceof Error) return { title: "Could not create invite", description: err.message };
  return {
    title: "Could not create invite",
    description: "Unexpected error.",
  };
}

function formatExpiresAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function buildInviteUrl(token: string): string {
  const origin =
    typeof window !== "undefined" && window.location.origin ? window.location.origin : "";
  return `${origin}/register?invite=${encodeURIComponent(token)}`;
}

export function InviteMemberDialog({ open, onOpenChange }: InviteMemberDialogProps): JSX.Element {
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<InvitationCreatedResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<{
    title: string;
    description: string;
  } | null>(null);

  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: "",
      expiresInDays: 7,
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: InviteValues) =>
      invitations.create({
        email: values.email,
        expiresInDays: values.expiresInDays,
      }),
    onSuccess: (data) => {
      setCreated(data);
      setErrorMessage(null);
      void queryClient.invalidateQueries({ queryKey: ["invitations"] });
    },
    onError: (err) => {
      setErrorMessage(messageForError(err));
    },
  });

  function resetAll(): void {
    form.reset({ email: "", expiresInDays: 7 });
    setCreated(null);
    setErrorMessage(null);
    createMutation.reset();
  }

  function handleOpenChange(next: boolean): void {
    if (!next) resetAll();
    onOpenChange(next);
  }

  function onSubmit(values: InviteValues): void {
    setErrorMessage(null);
    // `mutate` (not `mutateAsync`) routes errors through `onError`; using
    // `mutateAsync` would re-throw and React would log it as unhandled.
    createMutation.mutate(values);
  }

  async function handleCopy(): Promise<void> {
    if (!created) return;
    const url = buildInviteUrl(created.token);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied");
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  const submitting = createMutation.isPending || form.formState.isSubmitting;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Invite created</DialogTitle>
              <DialogDescription>
                Copy this link and send it to {created.email}. The link expires{" "}
                {formatExpiresAt(created.expiresAt)}.
              </DialogDescription>
            </DialogHeader>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Invite link</CardTitle>
                <CardDescription>
                  Only shown once. Copy it now — you can't retrieve it later.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Input
                  readOnly
                  value={buildInviteUrl(created.token)}
                  aria-label="Invite link"
                  onFocus={(event) => {
                    event.currentTarget.select();
                  }}
                />
              </CardContent>
            </Card>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  handleOpenChange(false);
                }}
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  void handleCopy();
                }}
              >
                <Copy className="size-4" aria-hidden="true" />
                Copy link
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Invite a family member</DialogTitle>
              <DialogDescription>
                They'll create their own account using the link we generate and pair their own
                WhatsApp.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form
                onSubmit={(event) => {
                  void form.handleSubmit((values) => {
                    onSubmit(values);
                  })(event);
                }}
                noValidate
                className="flex flex-col gap-4"
              >
                {errorMessage ? (
                  <Alert variant="destructive" role="alert">
                    <AlertTitle>{errorMessage.title}</AlertTitle>
                    <AlertDescription>{errorMessage.description}</AlertDescription>
                  </Alert>
                ) : null}
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          autoComplete="email"
                          placeholder="family-member@example.com"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="expiresInDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Expires in</FormLabel>
                      <FormControl>
                        <Select
                          value={String(field.value)}
                          onValueChange={(value) => {
                            field.onChange(Number(value));
                          }}
                        >
                          <SelectTrigger className="w-full" aria-label="Expires in">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1 day</SelectItem>
                            <SelectItem value="7">7 days</SelectItem>
                            <SelectItem value="14">14 days</SelectItem>
                            <SelectItem value="30">30 days</SelectItem>
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      handleOpenChange(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        Sending…
                      </>
                    ) : (
                      "Send invite"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
