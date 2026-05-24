import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod/v3";
import { mcpHeader, getMcpHeaderName, isMcpHeader } from "./mcpHeader.js";

describe("mcpHeader", () => {
  it("mcpHeader(schema) marks the schema and stores no explicit name", () => {
    const s = mcpHeader(z.string());
    assert.equal(isMcpHeader(s), true);
    assert.equal(getMcpHeaderName(s), undefined);
  });

  it("mcpHeader(schema, name) stores the explicit name", () => {
    const s = mcpHeader(z.string(), "TenantId");
    assert.equal(isMcpHeader(s), true);
    assert.equal(getMcpHeaderName(s), "TenantId");
  });

  it("mcpHeader returns the same instance (chainable)", () => {
    const base = z.string();
    const wrapped = mcpHeader(base, "Region");
    assert.ok(Object.is(base, wrapped));
  });
});
