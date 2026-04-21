import express, { type Request } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { issueAccessToken } from "../auth/tokens.js";

import { type AuthedResponse, requireAuth } from "./auth.js";

function makeApp(): express.Express {
  const app = express();
  app.get("/me", requireAuth, (_req: Request, res: AuthedResponse) => {
    res.json({ user: res.locals.user });
  });
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
