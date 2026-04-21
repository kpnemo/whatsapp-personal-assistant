import { getPrisma } from "@wpa/db";

import { hashPassword, verifyPassword } from "./password.js";
import {
  ACCESS_TTL,
  REFRESH_TTL_DAYS,
  hashRefreshToken,
  issueAccessToken,
  issueRefreshToken,
} from "./tokens.js";

export type AuthErrorCode = "invalid_credentials" | "user_not_found" | "disabled";

export class AuthError extends Error {
  constructor(public code: AuthErrorCode) {
    super(code);
  }
}

export interface RequestMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export async function login(
  email: string,
  password: string,
  meta: RequestMeta,
): Promise<{ accessToken: string; refreshToken: string; userId: string; role: "admin" | "user" }> {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new AuthError("invalid_credentials");
  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) throw new AuthError("invalid_credentials");

  const accessToken = await issueAccessToken({ sub: user.id, role: user.role });
  const refresh = issueRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400 * 1000);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refresh.tokenHash,
      expiresAt,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return { accessToken, refreshToken: refresh.token, userId: user.id, role: user.role };
}

export async function rotateRefresh(
  oldToken: string,
  meta: RequestMeta,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  const prisma = getPrisma();
  const tokenHash = hashRefreshToken(oldToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) return null;

  const user = await prisma.user.findUnique({ where: { id: existing.userId } });
  if (!user) return null;

  const fresh = issueRefreshToken();
  const accessToken = await issueAccessToken({ sub: user.id, role: user.role });
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400 * 1000);

  await prisma.$transaction([
    prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } }),
    prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: fresh.tokenHash,
        expiresAt,
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
    }),
  ]);

  return { accessToken, refreshToken: fresh.token };
}

export async function revokeRefresh(token: string): Promise<void> {
  const prisma = getPrisma();
  const tokenHash = hashRefreshToken(token);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function registerUser(params: {
  email: string;
  password: string;
  encryptedDek: Buffer;
  role: "admin" | "user";
}): Promise<{ id: string }> {
  const prisma = getPrisma();
  const passwordHash = await hashPassword(params.password);
  const user = await prisma.user.create({
    data: {
      email: params.email,
      passwordHash,
      role: params.role,
      encryptedDek: params.encryptedDek,
    },
    select: { id: true },
  });
  return user;
}

export { ACCESS_TTL };
