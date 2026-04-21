import { ArrowRight, Smartphone } from "lucide-react";
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

import { useAuth } from "../stores/auth";

export function Dashboard(): JSX.Element {
  const { me } = useAuth();
  // NOTE: real pairing state will hydrate via useQuery(["pairStatus"]) once PA4 ships.
  // For now, render the CTA unconditionally.
  const hasPairedSession = false;

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
            {hasPairedSession
              ? "WhatsApp is paired."
              : "No WhatsApp session yet — pair your phone to begin."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Pairing uses the Baileys multi-device protocol. You'll scan a QR code or enter a pairing
          code on your phone.
        </CardContent>
        {!hasPairedSession ? (
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
