import { createApp } from "./app.js";
import { env } from "./env.js";
import { logger } from "./logger.js";

const app = createApp();
const server = app.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT }, "api listening");
});

const shutdown = (signal: string): void => {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
