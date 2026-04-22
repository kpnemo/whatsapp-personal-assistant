import type { JSX } from "react";
import { Navigate, Outlet } from "react-router";

import { useAuth } from "../stores/auth";

export function RequireAdmin(): JSX.Element | null {
  const { me, loading } = useAuth();
  // RequireAuth wraps us and owns the loading Skeleton; while auth is still
  // hydrating we render nothing to avoid a flash of the redirect.
  if (loading) return null;
  if (me?.role !== "admin") return <Navigate to="/" replace />;
  return <Outlet />;
}
