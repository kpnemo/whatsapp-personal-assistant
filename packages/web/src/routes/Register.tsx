import { type FormEvent, type JSX, useState } from "react";
import { useNavigate } from "react-router";

import { postJson } from "../api/client";

export function Register(): JSX.Element {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const nav = useNavigate();

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setErr(null);
    try {
      await postJson("/auth/register", {
        email,
        password,
        invitationToken: token || undefined,
      });
      void nav("/login");
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : "registration failed");
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6"
        onSubmit={(e) => {
          void onSubmit(e);
        }}
      >
        <h1 className="text-lg font-semibold">Create account</h1>
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
          minLength={12}
          placeholder="password (min 12 chars)"
          autoComplete="new-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
        <input
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
          type="text"
          placeholder="invitation token (not required for first user)"
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
          }}
        />
        {err && <p className="text-sm text-rose-400">{err}</p>}
        <button
          type="submit"
          className="w-full rounded-md bg-indigo-500 px-3 py-2 font-medium hover:bg-indigo-400"
        >
          Create
        </button>
      </form>
    </main>
  );
}
