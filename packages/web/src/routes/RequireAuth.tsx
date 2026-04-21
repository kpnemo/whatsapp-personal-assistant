import { type JSX, useEffect } from "react";
import { Navigate, Outlet } from "react-router";

import { Shell } from "../components/Shell";
import { useAuth } from "../stores/auth";

export function RequireAuth(): JSX.Element {
  const { me, loading, bootstrap } = useAuth();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (loading) {
    return <main className="grid min-h-screen place-items-center">Loading…</main>;
  }
  if (!me) return <Navigate to="/login" replace />;

  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}
