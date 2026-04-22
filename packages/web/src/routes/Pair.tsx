import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Loader2, Shield, Smartphone } from "lucide-react";
import { type JSX, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { ApiError, pair, parseRateLimitRetryAfter, type PairState } from "../api/client";

type UiState =
  | "tos_gate"
  | "generating"
  | "awaiting_scan"
  | "paired"
  | "error"
  | "expired"
  | "rate_limited";

/**
 * How often to re-request the QR PNG. The worker refreshes the underlying
 * Redis key every ~30s, but we cache-bust more aggressively so the user sees
 * the new code as soon as possible once the worker rotates it.
 */
const QR_REFRESH_MS = 5_000;

/**
 * How often to poll /api/pair/status while the user is actively pairing. The
 * backend is cheap — a single Redis GET + one DB read — so 1 Hz is fine.
 */
const STATUS_POLL_MS = 1_000;

/**
 * Map a server PairState into our local UI state machine. We only trust the
 * server to drive transitions OUT OF `tos_gate` / `rate_limited`; those two
 * are purely client-owned.
 */
function deriveUiFromServer(serverState: PairState, current: UiState): UiState {
  // tos_gate is the pre-init state — if the user hasn't clicked "Initialize"
  // yet we stay there regardless of what the server reports.
  if (current === "tos_gate") return current;
  // rate_limited is local + time-bound; let the countdown effect clear it.
  if (current === "rate_limited") return current;

  switch (serverState) {
    case "awaiting_scan":
      return "awaiting_scan";
    case "paired":
      return "paired";
    case "error":
      return "error";
    case "expired":
      return "expired";
    case "generating":
      return "generating";
    case "none":
    case "idle":
    default:
      // No active session server-side yet — keep whatever the client is
      // currently showing (e.g. we just POSTed /init and are waiting for
      // the worker to advance to `generating`).
      return current;
  }
}

/**
 * Formats a remaining-seconds count as `mm:ss` for the rate-limit countdown.
 * Caps at 99 minutes so we never render ridiculous 2000:xx strings.
 */
function formatCountdown(remainingSeconds: number): string {
  const clamped = Math.max(0, Math.min(remainingSeconds, 99 * 60));
  const mm = Math.floor(clamped / 60)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor(clamped % 60)
    .toString()
    .padStart(2, "0");
  return `${mm}:${ss}`;
}

export function Pair(): JSX.Element {
  const [uiState, setUiState] = useState<UiState>("tos_gate");
  const [qrTick, setQrTick] = useState<number>(() => Date.now());
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number>(0);
  const [disconnectOpen, setDisconnectOpen] = useState<boolean>(false);
  const navigate = useNavigate();

  // ---- /api/pair/status polling ----------------------------------------------------
  //
  // Only polls while we're in an "active" UI state. Stops once we reach a
  // terminal state (tos_gate / rate_limited / paired / error / expired) so the
  // page isn't spinning requests forever.
  const isPolling = uiState === "generating" || uiState === "awaiting_scan";

  const statusQuery = useQuery({
    queryKey: ["pair-status"],
    queryFn: () => pair.status(),
    refetchInterval: isPolling ? STATUS_POLL_MS : false,
    // Don't retry indefinitely on network errors — one attempt is enough to
    // surface the failure; the polling loop will pick it up again next tick.
    retry: false,
    enabled: uiState !== "tos_gate" && uiState !== "rate_limited",
  });

  // ---- Drive UI state transitions off the latest status payload --------------------
  useEffect(() => {
    if (!statusQuery.data) return;
    const next = deriveUiFromServer(statusQuery.data.state, uiState);
    if (next !== uiState) setUiState(next);
  }, [statusQuery.data, uiState]);

  // ---- QR cache-busting refresh while awaiting_scan --------------------------------
  useEffect(() => {
    if (uiState !== "awaiting_scan") return;
    const id = setInterval(() => {
      setQrTick(Date.now());
    }, QR_REFRESH_MS);
    return () => {
      clearInterval(id);
    };
  }, [uiState]);

  // ---- Rate-limit countdown --------------------------------------------------------
  useEffect(() => {
    if (uiState !== "rate_limited") return;
    if (retryAfterSeconds <= 0) return;
    const id = setInterval(() => {
      setRetryAfterSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1_000);
    return () => {
      clearInterval(id);
    };
  }, [uiState, retryAfterSeconds]);

  // ---- /api/pair/init mutation -----------------------------------------------------
  const initMutation = useMutation({
    mutationFn: () => pair.init(),
    onSuccess: () => {
      setUiState("generating");
      // Kick the status query immediately so the user sees the Skeleton
      // update into the QR as soon as the worker produces one, rather than
      // waiting up to STATUS_POLL_MS for the next tick.
      void statusQuery.refetch();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 429) {
        const seconds = parseRateLimitRetryAfter(err) ?? 60;
        setRetryAfterSeconds(seconds);
        setUiState("rate_limited");
        return;
      }
      const description = err instanceof Error ? err.message : "Unexpected error starting pairing.";
      toast.error(`Could not start pairing: ${description}`);
    },
  });

  function handleInitialize(): void {
    initMutation.mutate();
  }

  function handleRetry(): void {
    setUiState("tos_gate");
    initMutation.reset();
  }

  function handleRateLimitRetry(): void {
    setUiState("tos_gate");
    setRetryAfterSeconds(0);
    initMutation.reset();
  }

  const qrUrl = useMemo(() => `/api/pair/qr?t=${String(qrTick)}`, [qrTick]);
  const phoneNumber = statusQuery.data?.phoneNumber ?? null;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="size-5" aria-hidden="true" />
            Pair WhatsApp
          </CardTitle>
          <CardDescription>
            Link your WhatsApp account to let the assistant read your conversations.
          </CardDescription>
        </CardHeader>
        {renderBody({
          uiState,
          qrUrl,
          phoneNumber,
          retryAfterSeconds,
          isInitPending: initMutation.isPending,
          onInitialize: handleInitialize,
          onRetry: handleRetry,
          onRateLimitRetry: handleRateLimitRetry,
          onGoToDashboard: () => {
            void navigate("/");
          },
          onDisconnectClick: () => {
            setDisconnectOpen(true);
          },
        })}
      </Card>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect coming soon</AlertDialogTitle>
            <AlertDialogDescription>
              Disconnect + re-pair lands in P1-B. For now, if you need to detach, use the kill
              switch in the top bar and restart pairing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                setDisconnectOpen(false);
              }}
            >
              Got it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface BodyProps {
  uiState: UiState;
  qrUrl: string;
  phoneNumber: string | null;
  retryAfterSeconds: number;
  isInitPending: boolean;
  onInitialize: () => void;
  onRetry: () => void;
  onRateLimitRetry: () => void;
  onGoToDashboard: () => void;
  onDisconnectClick: () => void;
}

function renderBody(props: BodyProps): JSX.Element {
  switch (props.uiState) {
    case "tos_gate":
      return <TosGate onInitialize={props.onInitialize} isPending={props.isInitPending} />;
    case "generating":
      return <Generating />;
    case "awaiting_scan":
      return <AwaitingScan qrUrl={props.qrUrl} />;
    case "paired":
      return (
        <Paired
          phoneNumber={props.phoneNumber}
          onGoToDashboard={props.onGoToDashboard}
          onDisconnectClick={props.onDisconnectClick}
        />
      );
    case "error":
      return <ErrorView onRetry={props.onRetry} />;
    case "expired":
      return <ExpiredView onRetry={props.onRetry} />;
    case "rate_limited":
      return (
        <RateLimited retryAfterSeconds={props.retryAfterSeconds} onRetry={props.onRateLimitRetry} />
      );
  }
}

function TosGate({
  onInitialize,
  isPending,
}: {
  onInitialize: () => void;
  isPending: boolean;
}): JSX.Element {
  return (
    <>
      <CardContent className="flex flex-col gap-4">
        <Alert variant="destructive" role="alert">
          <AlertTitle>Terms-of-service notice.</AlertTitle>
          <AlertDescription>
            <p>
              Pairing uses{" "}
              <a
                href="https://github.com/WhiskeySockets/Baileys"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                Baileys
              </a>
              , an unofficial library that speaks WhatsApp&apos;s multi-device protocol. Connecting
              this number <strong>violates WhatsApp&apos;s Terms of Service</strong>. Your number
              can be banned. This is an open-source, self-hosted project for personal use — you bear
              the risk of pairing your own number.
            </p>
          </AlertDescription>
        </Alert>
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          onClick={onInitialize}
          disabled={isPending}
          aria-label="I understand, initialize pairing"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Shield className="size-4" aria-hidden="true" />
          )}
          I understand, initialize pairing
        </Button>
      </CardFooter>
    </>
  );
}

function Generating(): JSX.Element {
  return (
    <CardContent className="flex flex-col items-center gap-4 py-6" data-testid="pair-generating">
      <Skeleton className="size-64" />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        <span>Preparing QR code…</span>
      </div>
    </CardContent>
  );
}

function AwaitingScan({ qrUrl }: { qrUrl: string }): JSX.Element {
  return (
    <CardContent className="flex flex-col items-center gap-5">
      <img
        src={qrUrl}
        alt="Scan this QR code with WhatsApp"
        className="size-64 max-w-80 rounded-md border border-border bg-card"
        data-testid="pair-qr"
      />
      <ol className="w-full list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Open WhatsApp on your phone.</li>
        <li>Tap Settings → Linked Devices → Link a device.</li>
        <li>Scan this code.</li>
      </ol>
      <Alert role="status">
        <AlertTitle>QR refreshes every 30 seconds.</AlertTitle>
        <AlertDescription>
          Keep this tab open. This pairing will expire in 2 minutes if you don&apos;t scan.
        </AlertDescription>
      </Alert>
    </CardContent>
  );
}

function Paired({
  phoneNumber,
  onGoToDashboard,
  onDisconnectClick,
}: {
  phoneNumber: string | null;
  onGoToDashboard: () => void;
  onDisconnectClick: () => void;
}): JSX.Element {
  return (
    <>
      <CardContent className="flex flex-col items-center gap-3 py-6">
        {/*
          Note: the shadcn theme has no semantic "success" color at P1-A, so
          we fall back to emerald — the only deviation from pure semantic
          tokens. Flagged in the PA5 report. Revisit if we add a success
          variant to the theme.
        */}
        <Check
          className="size-12 text-emerald-600 dark:text-emerald-400"
          aria-hidden="true"
          data-testid="pair-check"
        />
        <p className="text-lg font-semibold">Connected</p>
        {phoneNumber ? (
          <p className="font-mono text-xl" data-testid="pair-phone">
            +{phoneNumber.replace(/^\+/, "")}
          </p>
        ) : null}
        <p className="text-center text-sm text-muted-foreground">
          Your WhatsApp is now linked. Keep this tab open — the assistant is ready to read your
          conversations (silent mode by default).
        </p>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button
          variant="outline"
          className="text-destructive"
          onClick={onDisconnectClick}
          aria-label="Disconnect"
        >
          Disconnect
        </Button>
        <Button onClick={onGoToDashboard}>Go to dashboard</Button>
      </CardFooter>
    </>
  );
}

function ErrorView({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <>
      <CardContent>
        <Alert variant="destructive" role="alert">
          <AlertTitle>Pairing failed</AlertTitle>
          <AlertDescription>Something went wrong. Please try again.</AlertDescription>
        </Alert>
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={onRetry}>Retry</Button>
      </CardFooter>
    </>
  );
}

function ExpiredView({ onRetry }: { onRetry: () => void }): JSX.Element {
  return (
    <>
      <CardContent>
        <Alert variant="destructive" role="alert">
          <AlertTitle>Pairing expired</AlertTitle>
          <AlertDescription>
            The pairing window expired before you scanned. Start a new pairing to try again.
          </AlertDescription>
        </Alert>
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={onRetry}>Retry</Button>
      </CardFooter>
    </>
  );
}

function RateLimited({
  retryAfterSeconds,
  onRetry,
}: {
  retryAfterSeconds: number;
  onRetry: () => void;
}): JSX.Element {
  const ready = retryAfterSeconds <= 0;
  return (
    <>
      <CardContent>
        <Alert variant="destructive" role="alert">
          <AlertTitle>Too many attempts</AlertTitle>
          <AlertDescription>
            {ready ? (
              <p>You can try again now.</p>
            ) : (
              <p>
                You can try again in{" "}
                <span className="font-mono" data-testid="pair-retry-countdown">
                  {formatCountdown(retryAfterSeconds)}
                </span>
                .
              </p>
            )}
          </AlertDescription>
        </Alert>
      </CardContent>
      <CardFooter className="justify-end">
        <Button onClick={onRetry} disabled={!ready}>
          Retry
        </Button>
      </CardFooter>
    </>
  );
}
