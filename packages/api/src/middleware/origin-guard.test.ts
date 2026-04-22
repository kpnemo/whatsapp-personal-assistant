import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { originGuard } from "./origin-guard.js";

function makeApp(allowed: readonly string[]): express.Express {
  const app = express();
  app.use(originGuard({ allowedOrigins: allowed }));
  app.get("/safe", (_req, res) => {
    res.json({ ok: true });
  });
  app.post("/mutate", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("originGuard", () => {
  const ALLOWED = "https://example.test";

  it("allows GET regardless of Origin (idempotent methods skip the check)", async () => {
    const res = await request(makeApp([ALLOWED]))
      .get("/safe")
      .set("Origin", "https://evil.test");
    expect(res.status).toBe(200);
  });

  it("allows POST when Origin matches the allow-list", async () => {
    const res = await request(makeApp([ALLOWED]))
      .post("/mutate")
      .set("Origin", ALLOWED);
    expect(res.status).toBe(200);
  });

  it("rejects POST with a mismatched Origin (403)", async () => {
    const res = await request(makeApp([ALLOWED]))
      .post("/mutate")
      .set("Origin", "https://evil.test");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "forbidden_origin" });
  });

  it("allows POST with no Origin header (non-browser / same-origin — SameSite handles CSRF)", async () => {
    const res = await request(makeApp([ALLOWED])).post("/mutate");
    expect(res.status).toBe(200);
  });
});
