process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/wpa_test";
process.env.REDIS_URL ??= "redis://localhost:6379/1";
process.env.JWT_SECRET ??= "a".repeat(64);
process.env.MASTER_KEY ??= Buffer.alloc(32, 1).toString("base64");
process.env.PUBLIC_ORIGIN ??= "http://localhost:3000";
// Quiet pino in tests — noisy request/rate-limit logs otherwise drown test output.
process.env.LOG_LEVEL ??= "fatal";
