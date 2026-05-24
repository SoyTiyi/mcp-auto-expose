import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mcpHeader } from "./mcpHeader.js";

describe("mcpHeader (fastify)", () => {
  it("stamps x-mcp-header with the verbatim name", () => {
    const prop = mcpHeader({ type: "string", description: "Tenant id" }, "TenantId");
    assert.equal(prop["x-mcp-header"], "TenantId");
    assert.equal(prop["type"], "string");
    assert.equal(prop["description"], "Tenant id");
  });

  it("does not mutate the input object", () => {
    const input = { type: "string" as const };
    const out = mcpHeader(input, "Region");
    assert.equal((input as Record<string, unknown>)["x-mcp-header"], undefined);
    assert.equal(out["x-mcp-header"], "Region");
  });
});
