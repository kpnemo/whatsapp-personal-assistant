import type { JSX } from "react";
import { Route, Routes } from "react-router";

import { AdminInvitations } from "./routes/admin/Invitations";
import { Dashboard } from "./routes/Dashboard";
import { Login } from "./routes/Login";
import { Pair } from "./routes/Pair";
import { Register } from "./routes/Register";
import { RequireAdmin } from "./routes/RequireAdmin";
import { RequireAuth } from "./routes/RequireAuth";

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/pair" element={<Pair />} />
        <Route element={<RequireAdmin />}>
          <Route path="/admin/invitations" element={<AdminInvitations />} />
        </Route>
      </Route>
    </Routes>
  );
}
