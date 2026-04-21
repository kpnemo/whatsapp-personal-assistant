import { type FormEvent, type JSX, useState } from "react";
import { Navigate, useNavigate } from "react-router";

import { useAuth } from "../stores/auth";

export function Login(): JSX.Element {
  const { me, login, error, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const nav = useNavigate();

  if (loading) return <Loading />;
  if (me) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    await login(email, password);
    if (useAuth.getState().me) void nav("/");
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6"
        onSubmit={(e) => {
          void onSubmit(e);
        }}
      >
        <h1 className="text-lg font-semibold">Sign in</h1>
        <input
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
          type="email"
          required
          placeholder="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
        />
        <input
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
          type="password"
          required
          placeholder="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button
          type="submit"
          className="w-full rounded-md bg-indigo-500 px-3 py-2 font-medium hover:bg-indigo-400"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}

function Loading(): JSX.Element {
  return <main className="grid min-h-screen place-items-center">Loading…</main>;
}
