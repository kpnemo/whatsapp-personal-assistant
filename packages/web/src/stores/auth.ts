import { create } from "zustand";

import { ApiError, apiFetch, postJson, setAccessToken } from "../api/client";

export type Role = "admin" | "user";

export interface Me {
  id: string;
  email: string;
  role: Role;
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  error: string | null;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  me: null,
  loading: true,
  error: null,

  bootstrap: async () => {
    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const { accessToken } = (await res.json()) as { accessToken: string };
        setAccessToken(accessToken);
        const me = await apiFetch<Me>("/auth/me");
        set({ me, loading: false });
        return;
      }
    } catch {
      // fall through to unauthenticated state
    }
    set({ loading: false });
  },

  login: async (email, password) => {
    set({ error: null });
    try {
      const res = await postJson<{ accessToken: string; userId: string; role: Role }>(
        "/auth/login",
        { email, password },
      );
      setAccessToken(res.accessToken);
      const me = await apiFetch<Me>("/auth/me");
      set({ me });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.status === 401
            ? "Invalid email or password"
            : err.message
          : err instanceof Error
            ? err.message
            : "login failed";
      set({ error: message });
    }
  },

  logout: async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } catch {
      // ignore network / already-logged-out errors
    }
    setAccessToken(null);
    set({ me: null });
  },
}));
