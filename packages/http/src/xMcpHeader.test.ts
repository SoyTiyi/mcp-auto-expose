import { describe, it, expect } from "vitest";
import { isValidXMcpHeaderName, sanitizeToolXMcpHeaders } from "./xMcpHeader.js";

describe("isValidXMcpHeaderName", () => {
  it("plain ASCII name is valid", () => {
    expect(isValidXMcpHeaderName("TenantId")).toBe(true);
    expect(isValidXMcpHeaderName("Region")).toBe(true);
    expect(isValidXMcpHeaderName("X-Custom_42")).toBe(true);
  });
  it("empty string is invalid", () => {
    expect(isValidXMcpHeaderName("")).toBe(false);
  });
  it("contains space → invalid", () => {
    expect(isValidXMcpHeaderName("Tenant Id")).toBe(false);
  });
  it("contains colon → invalid", () => {
    expect(isValidXMcpHeaderName("Tenant:Id")).toBe(false);
  });
  it("non-ASCII → invalid", () => {
    expect(isValidXMcpHeaderName("Región")).toBe(false);
  });
  it("control char → invalid", () => {
    expect(isValidXMcpHeaderName("Tenant\tId")).toBe(false);
  });
});

describe("sanitizeToolXMcpHeaders", () => {
  it("keeps valid annotations untouched", () => {
    const schema = {
      type: "object",
      properties: {
        tenant_id: { type: "string", "x-mcp-header": "TenantId" },
        invoice_id: { type: "string" },
      },
    } as Record<string, unknown>;
    const warns: string[] = [];
    sanitizeToolXMcpHeaders("create_invoice", schema, (code) => warns.push(code));
    const props = schema["properties"] as Record<string, Record<string, unknown>>;
    expect(props["tenant_id"]?.["x-mcp-header"]).toBe("TenantId");
    expect(warns).toEqual([]);
  });

  it("strips empty annotation and warns", () => {
    const schema = {
      type: "object",
      properties: { region: { type: "string", "x-mcp-header": "" } },
    } as Record<string, unknown>;
    const warns: string[] = [];
    sanitizeToolXMcpHeaders("t", schema, (code) => warns.push(code));
    expect(
      (schema["properties"] as Record<string, Record<string, unknown>>)["region"]?.["x-mcp-header"],
    ).toBe(undefined);
    expect(warns).toEqual(["xmcpheader-invalid-name"]);
  });

  it("strips non-primitive annotation and warns", () => {
    const schema = {
      type: "object",
      properties: { tags: { type: "array", items: { type: "string" }, "x-mcp-header": "Tags" } },
    } as Record<string, unknown>;
    const warns: string[] = [];
    sanitizeToolXMcpHeaders("t", schema, (code) => warns.push(code));
    expect(
      (schema["properties"] as Record<string, Record<string, unknown>>)["tags"]?.["x-mcp-header"],
    ).toBe(undefined);
    expect(warns).toEqual(["xmcpheader-non-primitive"]);
  });

  it("strips duplicate (case-insensitive) annotation and warns", () => {
    const schema = {
      type: "object",
      properties: {
        a: { type: "string", "x-mcp-header": "Region" },
        b: { type: "string", "x-mcp-header": "REGION" },
      },
    } as Record<string, unknown>;
    const warns: string[] = [];
    sanitizeToolXMcpHeaders("t", schema, (code) => warns.push(code));
    const props = schema["properties"] as Record<string, Record<string, unknown>>;
    expect(props["a"]?.["x-mcp-header"]).toBe("Region");
    expect(props["b"]?.["x-mcp-header"]).toBe(undefined);
    expect(warns).toEqual(["xmcpheader-duplicate"]);
  });
});
