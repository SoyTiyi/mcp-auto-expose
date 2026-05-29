import { describe, it, expect } from "vitest";
import { z } from "zod";
import { mcpHeader, getMcpHeaderName, isMcpHeader } from "./mcpHeader.js";

describe("mcpHeader", () => {
  it("mcpHeader(schema) marks the schema and stores no explicit name", () => {
    const s = mcpHeader(z.string());
    expect(isMcpHeader(s)).toBe(true);
    expect(getMcpHeaderName(s)).toBe(undefined);
  });

  it("mcpHeader(schema, name) stores the explicit name", () => {
    const s = mcpHeader(z.string(), "TenantId");
    expect(isMcpHeader(s)).toBe(true);
    expect(getMcpHeaderName(s)).toBe("TenantId");
  });

  it("mcpHeader returns the same instance (chainable)", () => {
    const base = z.string();
    const wrapped = mcpHeader(base, "Region");
    expect(Object.is(base, wrapped)).toBeTruthy();
  });
});
