import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "./app.js";

describe("app", () => {
  const app = createApp();

  it("GET /healthz returns ok", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /api/unknown rejects unauthenticated requests with 401", async () => {
    const res = await request(app).get("/api/unknown");
    expect(res.status).toBe(401);
  });

  it("sets helmet headers", async () => {
    const res = await request(app).get("/healthz");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});
