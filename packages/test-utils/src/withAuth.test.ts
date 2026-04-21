import express from "express";
import { describe, expect, it } from "vitest";

import { TEST_JWT_SECRET, verifyAccessToken } from "./fixtures.js";
import { withAuth } from "./withAuth.js";

interface ReflectBody {
  authorization: string | null;
  cookie: string | null;
}

function buildReflectApp(): express.Express {
  const app = express();
  app.get("/reflect", (req, res) => {
    const body: ReflectBody = {
      authorization: req.header("authorization") ?? null,
      cookie: req.header("cookie") ?? null,
    };
    res.json(body);
  });
  return app;
}

describe("withAuth", () => {
  it("attaches a bearer token for the given user", async () => {
    const app = buildReflectApp();
    const agent = await withAuth(app, {
      user: { id: "user_42", role: "admin" },
      jwtSecret: TEST_JWT_SECRET,
    });

    const res = await agent.get("/reflect");
    expect(res.status).toBe(200);
    const body = res.body as ReflectBody;
    expect(body.authorization).toMatch(/^Bearer /);

    const token = (body.authorization ?? "").replace(/^Bearer /, "");
    const claims = await verifyAccessToken(TEST_JWT_SECRET, token);
    expect(claims.sub).toBe("user_42");
    expect(claims.role).toBe("admin");
  });

  it("attaches the refresh cookie when refreshToken is provided", async () => {
    const app = buildReflectApp();
    const agent = await withAuth(app, {
      user: { id: "user_7", role: "user" },
      jwtSecret: TEST_JWT_SECRET,
      refreshToken: "test-refresh-abc",
    });

    const res = await agent.get("/reflect");
    const body = res.body as ReflectBody;
    expect(body.cookie).toContain("wpa_refresh=test-refresh-abc");
  });

  it("omits the refresh cookie when refreshToken is not provided", async () => {
    const app = buildReflectApp();
    const agent = await withAuth(app, {
      user: { id: "user_7", role: "user" },
      jwtSecret: TEST_JWT_SECRET,
    });

    const res = await agent.get("/reflect");
    const body = res.body as ReflectBody;
    expect(body.cookie).toBeNull();
  });
});
