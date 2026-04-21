import express, { type NextFunction, type Request } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { issueAccessToken } from "../auth/tokens.js";

import { type AuthedResponse, requireAdmin, requireAuth } from "./auth.js";

function makeApp(): express.Express {
  const app = express();
  app.get("/me", requireAuth, (_req: Request, res: AuthedResponse) => {
    res.json({ user: res.locals.user });
  });
  return app;
}

function makeAdminApp(role: "admin" | "user" | undefined): express.Express {
  const app = express();
  app.get(
    "/admin",
    (_req: Request, res: AuthedResponse, next: NextFunction) => {
      if (role) res.locals.user = { sub: "u1", role, exp: 0 };
      next();
    },
    requireAdmin,
    (_req: Request, res: AuthedResponse) => {
      res.json({ ok: true });
    },
  );
  return app;
}

describe("requireAuth", () => {
  it("rejects missing bearer", async () => {
    const res = await request(makeApp()).get("/me");
    expect(res.status).toBe(401);
  });

  it("accepts a valid bearer", async () => {
    const token = await issueAccessToken({ sub: "u1", role: "user" });
    const res = await request(makeApp()).get("/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const body = res.body as { user: { sub: string } };
    expect(body.user.sub).toBe("u1");
  });

  it("rejects tampered bearer", async () => {
    const token = await issueAccessToken({ sub: "u1", role: "user" });
    const res = await request(makeApp()).get("/me").set("Authorization", `Bearer ${token}x`);
    expect(res.status).toBe(401);
  });
});

describe("requireAdmin", () => {
  it("passes through when user is admin", async () => {
    const res = await request(makeAdminApp("admin")).get("/admin");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns 403 when user is not admin", async () => {
    const res = await request(makeAdminApp("user")).get("/admin");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "forbidden" });
  });

  it("returns 403 when no user on locals", async () => {
    const res = await request(makeAdminApp(undefined)).get("/admin");
    expect(res.status).toBe(403);
  });
});
