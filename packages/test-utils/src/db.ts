import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { PrismaClient } from "@wpa/db";
import { generateKey, serializeCiphertext, wrapDek } from "@wpa/shared";

import { TEST_MASTER_KEY, hashPassword } from "./fixtures.js";

const execFileAsync = promisify(execFile);

export interface TestDb {
  url: string;
  prisma: PrismaClient;
  teardown: () => Promise<void>;
}

/**
 * Resolve the absolute path to the @wpa/db package from inside @wpa/test-utils.
 * Using a relative path (../../db) since the worktree layout is fixed:
 * packages/test-utils/src/db.ts -> packages/db.
 */
function resolveDbPackageDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Works for both src/ (dev) and dist/ (post-build); both sit one level under packages/test-utils.
  return resolve(here, "..", "..", "db");
}

/**
 * Spin up a disposable postgres:16-alpine container, run @wpa/db's prisma
 * migrations against it, and hand back a connected PrismaClient.
 *
 * Teardown disconnects Prisma and stops the container — call it in afterAll/finally.
 */
export async function makeTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("wpa_test")
    .withUsername("wpa_test")
    .withPassword("wpa_test")
    .start();

  const url = container.getConnectionUri();

  // prisma migrate deploy is idempotent; we intentionally shell out rather than
  // call the migrate engine programmatically because the published API is
  // internal and churns between minor versions.
  const dbDir = resolveDbPackageDir();
  await execFileAsync(
    "node_modules/.bin/prisma",
    ["migrate", "deploy", "--schema", "prisma/schema.prisma"],
    {
      cwd: dbDir,
      env: { ...process.env, DATABASE_URL: url },
    },
  );

  const prisma = new PrismaClient({ datasourceUrl: url });

  return {
    url,
    prisma,
    teardown: async () => {
      await prisma.$disconnect();
      await container.stop();
    },
  };
}

export interface SeedUserInput {
  email: string;
  role: "admin" | "user";
  password: string;
}

export interface SeededUser {
  id: string;
  email: string;
  role: "admin" | "user";
  passwordHash: string;
  encryptedDek: Buffer;
}

/**
 * Insert a User with argon2id password hash + wrapped DEK, plus a `register`
 * AuditLog row. Mirrors @wpa/api's registerUser() so seeded rows look identical
 * to production-created ones.
 */
export async function seedUser(prisma: PrismaClient, input: SeedUserInput): Promise<SeededUser> {
  const passwordHash = await hashPassword(input.password);
  const dek = generateKey();
  const wrapped = wrapDek(TEST_MASTER_KEY, dek);
  const encryptedDek = Buffer.from(serializeCiphertext(wrapped));

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      role: input.role,
      encryptedDek,
    },
    select: { id: true, email: true, role: true, passwordHash: true, encryptedDek: true },
  });

  await prisma.auditLog.create({
    data: { userId: user.id, type: "register" },
  });

  return {
    id: user.id,
    email: user.email,
    role: user.role,
    passwordHash: user.passwordHash,
    encryptedDek: Buffer.from(user.encryptedDek),
  };
}

export interface SeedInvitationInput {
  email: string;
  /** Milliseconds from now until the invite expires. */
  expiresIn: number;
  /** User.id of the inviter (must already exist). */
  invitedBy: string;
}

export interface SeededInvitation {
  id: string;
  /** Plaintext token — hand this to your test, not the hashed version. */
  token: string;
}

/**
 * Insert an Invitation row. Hashes the token with sha256 (matching
 * hashRefreshToken in @wpa/api, which invitations piggy-back on).
 */
export async function seedInvitation(
  prisma: PrismaClient,
  input: SeedInvitationInput,
): Promise<SeededInvitation> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + input.expiresIn);

  const inv = await prisma.invitation.create({
    data: {
      email: input.email,
      tokenHash,
      expiresAt,
      invitedById: input.invitedBy,
    },
    select: { id: true },
  });

  return { id: inv.id, token };
}
