import type { JSX, ReactNode } from "react";

import { useAuth } from "../stores/auth";

import { ThemeToggle } from "./theme-toggle";

export function Shell({ children }: { children: ReactNode }): JSX.Element {
  const { me, logout } = useAuth();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="font-semibold">WhatsApp Personal Assistant</span>
          <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-400">P0</span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <button
            type="button"
            title="Emergency: mute assistant"
            className="rounded-md border border-rose-700 px-3 py-1 text-sm text-rose-300 hover:bg-rose-900/30"
            onClick={() => {
              window.alert("Kill switch wires to /wpa:kill in P3");
            }}
          >
            Kill switch
          </button>
          <span className="text-sm text-slate-400">{me?.email}</span>
          <button
            type="button"
            className="rounded-md border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800"
            onClick={() => {
              void logout();
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="w-64 border-r border-slate-800 bg-slate-900/30 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Conversations</p>
          <p className="mt-3 text-sm text-slate-400">None yet — pair WhatsApp in P1.</p>
        </aside>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
