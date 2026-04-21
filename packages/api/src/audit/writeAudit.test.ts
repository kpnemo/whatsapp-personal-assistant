import { describe, expect, it } from "vitest";

import { decodeAuditDetails, encodeAuditDetails } from "./writeAudit.js";

describe("audit details encoding", () => {
  it("round-trips JSON details", () => {
    const key = Buffer.alloc(32, 7);
    const details = { reason: "manual", ip: "1.2.3.4", trace: ["a", "b"] };
    const encoded = encodeAuditDetails(key, details);
    expect(encoded).toBeDefined();
    expect(decodeAuditDetails(key, encoded!)).toEqual(details);
  });

  it("produces undefined when details omitted", () => {
    expect(encodeAuditDetails(Buffer.alloc(32, 1), undefined)).toBeUndefined();
  });
});
