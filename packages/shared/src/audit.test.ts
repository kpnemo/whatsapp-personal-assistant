import { describe, expect, it, vi } from "vitest";

import { decodeAuditDetails, encodeAuditDetails, writeAudit } from "./audit.js";

describe("audit helpers", () => {
  it("encode/decode round-trips arbitrary details through AES-GCM", () => {
    const key = Buffer.alloc(32, 7);
    const details = { reason: "manual", ip: "1.2.3.4", trace: ["a", "b"] };
    const encoded = encodeAuditDetails(key, details);
    expect(encoded).toBeDefined();
    expect(decodeAuditDetails(key, encoded!)).toEqual(details);
  });

  it("encodeAuditDetails returns undefined when details is undefined", () => {
    expect(encodeAuditDetails(Buffer.alloc(32, 1), undefined)).toBeUndefined();
  });

  it("writeAudit calls prisma.auditLog.create with encrypted details", async () => {
    const key = Buffer.alloc(32, 3);
    const create = vi.fn().mockResolvedValue({});
    const prisma = { auditLog: { create } } as unknown as Parameters<
      typeof writeAudit
    >[0]["prisma"];

    await writeAudit({
      prisma,
      masterKey: key,
      userId: "user-1",
      type: "login",
      details: { ip: "127.0.0.1" },
    });

    expect(create).toHaveBeenCalledOnce();
    const call = create.mock.calls[0]![0] as {
      data: { userId: string; type: string; details: Buffer | null };
    };
    expect(call.data.userId).toBe("user-1");
    expect(call.data.type).toBe("login");
    expect(call.data.details).toBeInstanceOf(Buffer);
    expect(decodeAuditDetails(key, call.data.details!)).toEqual({ ip: "127.0.0.1" });
  });

  it("writeAudit swallows prisma failures and invokes logger.error", async () => {
    const key = Buffer.alloc(32, 4);
    const err = new Error("db offline");
    const create = vi.fn().mockRejectedValue(err);
    const prisma = { auditLog: { create } } as unknown as Parameters<
      typeof writeAudit
    >[0]["prisma"];
    const logError = vi.fn();
    await expect(
      writeAudit({ prisma, masterKey: key, type: "logout", logger: { error: logError } }),
    ).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledOnce();
  });

  it("writeAudit omits optional fields when not supplied", async () => {
    const key = Buffer.alloc(32, 5);
    const create = vi.fn().mockResolvedValue({});
    const prisma = { auditLog: { create } } as unknown as Parameters<
      typeof writeAudit
    >[0]["prisma"];
    await writeAudit({ prisma, masterKey: key, type: "register" });
    const call = create.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(call.data.userId).toBeNull();
    expect(call.data.targetRef).toBeNull();
    expect(call.data.details).toBeNull();
  });
});
