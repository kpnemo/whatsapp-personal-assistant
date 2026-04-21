import path from "node:path";
import { fileURLToPath } from "node:url";

import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

import { env } from "./env.js";
import { logger } from "./logger.js";
import { authRouter } from "./routes/auth.js";
import { invitationsRouter } from "./routes/invitations.js";

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
  app.use(pinoHttp({ logger }));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/readyz", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api", authRouter());
  app.use("/api", invitationsRouter());

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
