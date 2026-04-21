import type { JSX } from "react";

export function Dashboard(): JSX.Element {
  return (
    <div className="mx-auto max-w-2xl rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <h1 className="text-lg font-semibold">Welcome</h1>
      <p className="mt-2 text-sm text-slate-400">P0 foundation is running. Pair WhatsApp in P1.</p>
    </div>
  );
}
