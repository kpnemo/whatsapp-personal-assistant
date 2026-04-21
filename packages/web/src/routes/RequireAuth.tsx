import type { JSX } from "react";
import { Outlet } from "react-router";

export function RequireAuth(): JSX.Element {
  return <Outlet />;
}
