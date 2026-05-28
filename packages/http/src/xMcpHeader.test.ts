import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidXMcpHeaderName, sanitizeToolXMcpHeaders } from "./xMcpHeader.js";

describe("isValidXMcpHeaderName", () => {
  it("plain ASCII name is valid", () => {
    assert.equal(isValidXMcpHeaderName("TenantId"), true);
    assert.equal(isValidXMcpHeaderName("Region"), true);
    assert.equal(isValidXMcpHeaderName("X-Custom_42"), true);
  });
  it("empty string is invalid", () => {
    assert.equal(isValidXMcpHeaderName(""), false);
  });
  it("contains space → invalid", () => {
    assert.equal(isValidXMcpHeaderName("Tenant Id"), false);
  });
  it("contains colon → invalid", () => {
    assert.equal(isValidXMcpHeaderName("Tenant:Id"), false);
  });
  it("non-ASCII → invalid", () => {
    assert.equal(isValidXMcpHeaderName("Región"), false);
  });
  it("control char → invalid", () => {
    assert.equal(isValidXMcpHeaderName("Tenant\tId"), false);
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
    assert.equal(props["tenant_id"]?.["x-mcp-header"], "TenantId");
    assert.deepEqual(warns, []);
  });

  it("strips empty annotation and warns", () => {
    const schema = {
      type: "object",
      properties: { region: { type: "string", "x-mcp-header": "" } },
    } as Record<string, unknown>;
    const warns: string[] = [];
    sanitizeToolXMcpHeaders("t", schema, (code) => warns.push(code));
    assert.equal(
      (schema["properties"] as Record<string, Record<string, unknown>>)["region"]?.["x-mcp-header"],
      undefined,
    );
    assert.deepEqual(warns, ["xmcpheader-invalid-name"]);
  });

  it("strips non-primitive annotation and warns", () => {
    const schema = {
      type: "object",
      properties: { tags: { type: "array", items: { type: "string" }, "x-mcp-header": "Tags" } },
    } as Record<string, unknown>;
    const warns: string[] = [];
    sanitizeToolXMcpHeaders("t", schema, (code) => warns.push(code));
    assert.equal(
      (schema["properties"] as Record<string, Record<string, unknown>>)["tags"]?.["x-mcp-header"],
      undefined,
    );
    assert.deepEqual(warns, ["xmcpheader-non-primitive"]);
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
    assert.equal(props["a"]?.["x-mcp-header"], "Region");
    assert.equal(props["b"]?.["x-mcp-header"], undefined);
    assert.deepEqual(warns, ["xmcpheader-duplicate"]);
  });
});
