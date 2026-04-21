import { pino } from "pino";

import { env } from "./env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "password",
      "passwordHash",
      "*.password",
      "*.passwordHash",
      "token",
      "refreshToken",
      "accessToken",
      "authorization",
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "masterKey",
      "MASTER_KEY",
      "anthropicApiKey",
      "encryptedDek",
      "authState",
      "ciphertext",
      "body.password",
      "body.token",
    ],
    censor: "[REDACTED]",
  },
  formatters: { level: (label: string) => ({ level: label }) },
});
