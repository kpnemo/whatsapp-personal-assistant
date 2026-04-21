import { z } from "zod";

const boolish = z
  .union([z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0")])
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .url()
    .refine((s) => s.startsWith("postgres://") || s.startsWith("postgresql://"), {
      message: "DATABASE_URL must be a postgres url",
    }),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  MASTER_KEY: z
    .string()
    .min(1)
    .transform((b64, ctx) => {
      const buf = Buffer.from(b64, "base64");
      if (buf.length !== 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "MASTER_KEY must decode to 32 bytes (base64)",
        });
        return z.NEVER;
      }
      return buf;
    }),
  API_PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_ORIGIN: z.string().url(),
  OPEN_REGISTRATION: boolish.default("false"),
  ENTRYPOINT_ROLE: z.enum(["api", "worker", "agent", "all"]).default("all"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type ParsedEnv = z.infer<typeof envSchema> & { MASTER_KEY_BYTES: Buffer };

export function parseEnv(raw: Record<string, string | undefined>): ParsedEnv {
  const parsed = envSchema.parse(raw);
  return {
    ...parsed,
    MASTER_KEY_BYTES: parsed.MASTER_KEY,
  };
}
