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
      // Decrypted message content — must never reach logs via SSE or any route.
      "body", // top-level body
      "*.body", // nested body (e.g., req.body)
      "text",
      "*.text",
      "name",
      "*.name",
      "subject",
      "*.subject",
      "description",
      "*.description",
      "body.text", // explicit deep paths kept for clarity
      "message.body",
      "conversation.title",
    ],
    remove: true,
  },
  formatters: { level: (label: string) => ({ level: label }) },
});
