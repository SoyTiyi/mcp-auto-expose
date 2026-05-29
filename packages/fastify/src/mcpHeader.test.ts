import { describe, it, expect } from "vitest";
import { mcpHeader } from "./mcpHeader.js";

describe("mcpHeader (fastify)", () => {
  it("stamps x-mcp-header with the verbatim name", () => {
    const prop = mcpHeader({ type: "string", description: "Tenant id" }, "TenantId");
    expect(prop["x-mcp-header"]).toBe("TenantId");
    expect(prop["type"]).toBe("string");
    expect(prop["description"]).toBe("Tenant id");
  });

  it("does not mutate the input object", () => {
    const input = { type: "string" as const };
    const out = mcpHeader(input, "Region");
    expect((input as Record<string, unknown>)["x-mcp-header"]).toBe(undefined);
    expect(out["x-mcp-header"]).toBe("Region");
  });
});
