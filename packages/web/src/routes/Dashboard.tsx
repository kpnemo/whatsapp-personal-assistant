import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Smartphone } from "lucide-react";
import { type JSX } from "react";
import { Link } from "react-router";

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

import { pair } from "../api/client";
import { useAuth } from "../stores/auth";

export function Dashboard(): JSX.Element {
  const { me } = useAuth();
  // Shared cache key with the /pair screen so both pages stay in sync via
  // TanStack Query's store.
  const pairStatus = useQuery({
    queryKey: ["pair-status"],
    queryFn: () => pair.status(),
    // Cheap enough to allow brief staleness — avoids hammering on dashboard hover.
    staleTime: 10_000,
    // Failure on the dashboard should never block rendering — just fall back
    // to the CTA so the user can still reach /pair.
    retry: false,
  });

  const isPaired = pairStatus.data?.state === "paired";
  const pairedPhone = isPaired ? (pairStatus.data?.phoneNumber ?? null) : null;

  return (
    <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
          <CardDescription>{me?.email ?? "Signed in"}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          P0 foundation is running. Pair your WhatsApp account to start capturing conversations; the
          assistant stays silent until you switch modes.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="size-4" aria-hidden="true" />
            Pair WhatsApp
          </CardTitle>
          <CardDescription>
            {isPaired
              ? "WhatsApp is linked."
              : "No WhatsApp session yet — pair your phone to begin."}
          </CardDescription>
        </CardHeader>
        {isPaired ? (
          <CardContent className="flex items-center gap-2 text-sm" data-testid="dashboard-paired">
            <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <span className="font-medium">WhatsApp linked:</span>
            <span className="font-mono text-muted-foreground">
              {pairedPhone ? `+${pairedPhone.replace(/^\+/, "")}` : "connected"}
            </span>
          </CardContent>
        ) : (
          <CardContent className="text-sm text-muted-foreground">
            Pairing uses the Baileys multi-device protocol. You&apos;ll scan a QR code or enter a
            pairing code on your phone.
          </CardContent>
        )}
        {!isPaired ? (
          <CardFooter>
            <Button asChild>
              <Link to="/pair">
                Start pairing
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          </CardFooter>
        ) : null}
      </Card>

      <Card className="sm:col-span-2">
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Message-derived events will appear here once paired.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
