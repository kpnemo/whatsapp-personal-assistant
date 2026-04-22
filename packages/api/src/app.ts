import path from "node:path";
import { fileURLToPath } from "node:url";

import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { env } from "./env.js";
import { logger } from "./logger.js";
import { originGuard } from "./middleware/origin-guard.js";
import { authRouter } from "./routes/auth.js";
import { conversationsRouter } from "./routes/conversations.js";
import { invitationsRouter } from "./routes/invitations.js";
import { killRouter } from "./routes/kill.js";
import { mediaRouter } from "./routes/media.js";
import { messagesRouter } from "./routes/messages.js";
import { pairRouter } from "./routes/pair.js";

export function createApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet());
  app.use(
    cors({
      origin: env.PUBLIC_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  // CSRF defence-in-depth: SameSite=Strict on the refresh cookie is primary;
  // this rejects unsafe-method requests whose Origin header is set but doesn't
  // match our allow-list. Must run after cookieParser so guard can protect
  // cookie-bearing mutations.
  app.use(originGuard({ allowedOrigins: [env.PUBLIC_ORIGIN] }));
  app.use(pinoHttp({ logger }));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/readyz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api", authRouter());
  app.use("/api", invitationsRouter());
  app.use("/api", killRouter());
  app.use("/api", pairRouter());
  app.use("/api", conversationsRouter());
  app.use("/api", messagesRouter());
  app.use("/api", mediaRouter());

  const webDist =
    process.env.WEB_DIST ?? path.resolve(fileURLToPath(import.meta.url), "../../../web/dist");
  app.use(express.static(webDist, { index: false }));
  app.get(/^(?!\/api(\/|$)).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  app.use(((err: Error, _req, res, _next) => {
    logger.error({ err }, "unhandled error");
    res.status(500).json({ error: "internal_error" });
  }) as express.ErrorRequestHandler);

  return app;
}
