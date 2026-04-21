import { type JSX, useEffect } from "react";
import { Navigate, Outlet } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";

import { Shell } from "../components/Shell";
import { useAuth } from "../stores/auth";

function ShellSkeleton(): JSX.Element {
  return (
    <div
      data-testid="require-auth-loading"
      className="flex min-h-screen flex-col bg-background text-foreground"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-8" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="size-9 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-32 rounded-md" />
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="w-60 shrink-0 border-r border-border bg-muted/30 p-3">
          <Skeleton className="mb-2 h-3 w-20" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </aside>
        <main className="flex-1 p-6">
          <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-40 w-full sm:col-span-2" />
          </div>
        </main>
      </div>
    </div>
  );
}

export function RequireAuth(): JSX.Element {
  const { me, loading, bootstrap } = useAuth();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (loading) return <ShellSkeleton />;
  if (!me) return <Navigate to="/login" replace />;

  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}
