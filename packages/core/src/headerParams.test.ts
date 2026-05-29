import { describe, it, expect } from "vitest";
import {
  encodeHeaderValue,
  decodeHeaderValue,
  collectExpectedHeaderParams,
  validateAndMergeHeaderParams,
} from "./headerParams.js";

describe("encodeHeaderValue", () => {
  it("plain ASCII printable stays plain", () => {
    expect(encodeHeaderValue("us-west1")).toBe("us-west1");
    expect(encodeHeaderValue("us west 1")).toBe("us west 1");
    expect(encodeHeaderValue("42")).toBe("42");
  });
  it("leading whitespace triggers sentinel", () => {
    expect(encodeHeaderValue(" us-west1")).toBe("=?base64?IHVzLXdlc3Qx?=");
  });
  it("trailing whitespace triggers sentinel", () => {
    expect(encodeHeaderValue("us-west1 ")).toBe("=?base64?dXMtd2VzdDEg?=");
  });
  it("non-ASCII triggers sentinel with standard Base64 (with padding ==)", () => {
    expect(encodeHeaderValue("Hello, 世界")).toBe("=?base64?SGVsbG8sIOS4lueVjA==?=");
  });
  it("newline triggers sentinel", () => {
    expect(encodeHeaderValue("line1\nline2")).toBe("=?base64?bGluZTEKbGluZTI=?=");
  });
});

describe("decodeHeaderValue", () => {
  it("plain value returns as-is", () => {
    expect(decodeHeaderValue("us-west1")).toEqual({ ok: true, value: "us-west1" });
  });
  it("sentinel-wrapped Base64 decodes", () => {
    expect(decodeHeaderValue("=?base64?SGVsbG8=?=")).toEqual({ ok: true, value: "Hello" });
  });
  it("sentinel prefix is case-insensitive (=?BASE64?)", () => {
    expect(decodeHeaderValue("=?BASE64?SGVsbG8=?=")).toEqual({ ok: true, value: "Hello" });
  });
  it("invalid Base64 inside sentinel → ok: false", () => {
    const r = decodeHeaderValue("=?base64?!!!?=");
    expect(r.ok).toBe(false);
  });
  it("missing closing sentinel → treated as literal", () => {
    expect(decodeHeaderValue("=?base64?SGVsbG8=")).toEqual({
      ok: true,
      value: "=?base64?SGVsbG8=",
    });
  });
});

describe("collectExpectedHeaderParams", () => {
  it("returns a map { 'mcp-param-<lowercase-name>': propKey } for x-mcp-header props", () => {
    const schema = {
      properties: {
        tenant_id: { type: "string", "x-mcp-header": "TenantId" },
        region: { type: "string", "x-mcp-header": "Region" },
        invoice_id: { type: "string" },
      },
    };
    const result = collectExpectedHeaderParams(schema);
    expect(result).toEqual({
      "mcp-param-tenantid": "tenant_id",
      "mcp-param-region": "region",
    });
  });
  it("empty schema returns {}", () => {
    expect(collectExpectedHeaderParams({})).toEqual({});
  });
});

describe("validateAndMergeHeaderParams", () => {
  const schema = {
    properties: {
      tenant_id: { type: "string", "x-mcp-header": "TenantId" },
      invoice_id: { type: "string" },
    },
  };

  it("matching header + body → merged + ok", () => {
    const result = validateAndMergeHeaderParams(
      schema,
      { tenant_id: "acme", invoice_id: "inv-1" },
      { "mcp-param-tenantid": "acme" },
    );
    expect(result).toEqual({ ok: true, args: { tenant_id: "acme", invoice_id: "inv-1" } });
  });

  it("body arg missing, header present → header injected", () => {
    const result = validateAndMergeHeaderParams(
      schema,
      { invoice_id: "inv-1" },
      { "mcp-param-tenantid": "acme" },
    );
    expect(result).toEqual({ ok: true, args: { tenant_id: "acme", invoice_id: "inv-1" } });
  });

  it("body arg present, header absent → ok: false reason: header-missing", () => {
    const result = validateAndMergeHeaderParams(
      schema,
      { tenant_id: "acme", invoice_id: "inv-1" },
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("header-missing");
      expect(result.detail).toMatch(/TenantId/);
    }
  });

  it("body arg present, header mismatches → ok: false reason: header-mismatch", () => {
    const result = validateAndMergeHeaderParams(
      schema,
      { tenant_id: "acme", invoice_id: "inv-1" },
      { "mcp-param-tenantid": "evil" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("header-mismatch");
      expect(result.detail).toMatch(/TenantId/);
    }
  });

  it("Base64-encoded header decoded before comparison", () => {
    const result = validateAndMergeHeaderParams(
      schema,
      { tenant_id: "Hello, 世界", invoice_id: "inv-1" },
      { "mcp-param-tenantid": "=?base64?SGVsbG8sIOS4lueVjA==?=" },
    );
    expect(result).toEqual({ ok: true, args: { tenant_id: "Hello, 世界", invoice_id: "inv-1" } });
  });

  it("invalid Base64 → ok: false reason: invalid-base64", () => {
    const result = validateAndMergeHeaderParams(
      schema,
      { tenant_id: "x", invoice_id: "inv-1" },
      { "mcp-param-tenantid": "=?base64?!!!?=" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid-base64");
    }
  });

  it("schema has no x-mcp-header properties → trivially ok", () => {
    const result = validateAndMergeHeaderParams(
      { properties: { a: { type: "string" } } },
      { a: "1" },
      {},
    );
    expect(result).toEqual({ ok: true, args: { a: "1" } });
  });
});
