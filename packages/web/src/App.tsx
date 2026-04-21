import type { JSX } from "react";
import { Route, Routes } from "react-router";

import { Dashboard } from "./routes/Dashboard";
import { Login } from "./routes/Login";
import { Register } from "./routes/Register";
import { RequireAuth } from "./routes/RequireAuth";

export function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Dashboard />} />
      </Route>
    </Routes>
  );
}
