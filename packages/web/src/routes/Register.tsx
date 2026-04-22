import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MailCheck } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

import { ApiError, postJson } from "../api/client";

const registerSchema = z.object({
  email: z.string().email({ message: "Enter a valid email address." }),
  password: z.string().min(12, { message: "Password must be at least 12 characters." }),
  invitationToken: z.string().optional(),
});

type RegisterValues = z.infer<typeof registerSchema>;

function messageForError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.message;
    if (/invite_required/i.test(body)) {
      return "Registration requires a valid invitation token.";
    }
    if (/invalid_invite/i.test(body)) {
      return "That invitation is invalid, expired, or already used.";
    }
    if (err.status === 400) {
      return "Some fields are invalid. Double-check email and password.";
    }
    return body;
  }
  if (err instanceof Error) return err.message;
  return "Registration failed.";
}

export function Register(): JSX.Element {
  const [searchParams] = useSearchParams();
  const inviteFromUrl = searchParams.get("invite") ?? "";
  const [serverError, setServerError] = useState<string | null>(null);
  const nav = useNavigate();

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: "",
      password: "",
      invitationToken: inviteFromUrl,
    },
  });

  useEffect(() => {
    // Keep the hidden invite field in sync if the URL changes after mount.
    form.setValue("invitationToken", inviteFromUrl);
  }, [inviteFromUrl, form]);

  const hasInvite = inviteFromUrl.length > 0;

  async function onSubmit(values: RegisterValues): Promise<void> {
    setServerError(null);
    try {
      await postJson("/auth/register", {
        email: values.email,
        password: values.password,
        invitationToken:
          values.invitationToken && values.invitationToken.length > 0
            ? values.invitationToken
            : undefined,
      });
      void nav("/login");
    } catch (err) {
      setServerError(messageForError(err));
    }
  }

  const submitting = form.formState.isSubmitting;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Create account</CardTitle>
          <CardDescription>
            Set up your personal assistant login. Registration is invite-only after the first user.
          </CardDescription>
        </CardHeader>
        <Form {...form}>
          <form
            onSubmit={(event) => {
              void form.handleSubmit(onSubmit)(event);
            }}
            noValidate
          >
            <CardContent className="flex flex-col gap-4">
              {hasInvite ? (
                <Alert role="status" data-testid="invite-banner">
                  <MailCheck className="size-4" aria-hidden="true" />
                  <AlertTitle>You've been invited to join</AlertTitle>
                  <AlertDescription>Create your account below to accept.</AlertDescription>
                </Alert>
              ) : null}
              {serverError ? (
                <Alert variant="destructive" role="alert">
                  <AlertTitle>Registration failed</AlertTitle>
                  <AlertDescription>{serverError}</AlertDescription>
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
                        placeholder="you@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        placeholder="At least 12 characters"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="invitationToken"
                render={({ field }) =>
                  hasInvite ? (
                    <Input
                      type="hidden"
                      data-testid="invite-token-hidden"
                      className="hidden"
                      name={field.name}
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      ref={field.ref}
                    />
                  ) : (
                    <FormItem>
                      <FormLabel>Invitation token</FormLabel>
                      <FormControl>
                        <Input
                          type="text"
                          placeholder="Leave blank for the first user"
                          autoComplete="off"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )
                }
              />
              <Button type="submit" disabled={submitting} className="w-full">
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Creating account…
                  </>
                ) : (
                  "Create account"
                )}
              </Button>
            </CardContent>
          </form>
        </Form>
        <CardFooter className="justify-center text-sm text-muted-foreground">
          <span>Already have an account?</span>
          <Button variant="link" asChild className="px-1">
            <Link to="/login">Sign in</Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}
