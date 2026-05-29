import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  encodeHeaderValue,
  decodeHeaderValue,
  collectExpectedHeaderParams,
  validateAndMergeHeaderParams,
} from "./headerParams.js";

describe("encodeHeaderValue", () => {
  it("plain ASCII printable stays plain", () => {
    assert.equal(encodeHeaderValue("us-west1"), "us-west1");
    assert.equal(encodeHeaderValue("us west 1"), "us west 1");
    assert.equal(encodeHeaderValue("42"), "42");
  });
  it("leading whitespace triggers sentinel", () => {
    assert.equal(encodeHeaderValue(" us-west1"), "=?base64?IHVzLXdlc3Qx?=");
  });
  it("trailing whitespace triggers sentinel", () => {
    assert.equal(encodeHeaderValue("us-west1 "), "=?base64?dXMtd2VzdDEg?=");
  });
  it("non-ASCII triggers sentinel with standard Base64 (with padding ==)", () => {
    assert.equal(encodeHeaderValue("Hello, 世界"), "=?base64?SGVsbG8sIOS4lueVjA==?=");
  });
  it("newline triggers sentinel", () => {
    assert.equal(encodeHeaderValue("line1\nline2"), "=?base64?bGluZTEKbGluZTI=?=");
  });
});

describe("decodeHeaderValue", () => {
  it("plain value returns as-is", () => {
    assert.deepEqual(decodeHeaderValue("us-west1"), { ok: true, value: "us-west1" });
  });
  it("sentinel-wrapped Base64 decodes", () => {
    assert.deepEqual(decodeHeaderValue("=?base64?SGVsbG8=?="), { ok: true, value: "Hello" });
  });
  it("sentinel prefix is case-insensitive (=?BASE64?)", () => {
    assert.deepEqual(decodeHeaderValue("=?BASE64?SGVsbG8=?="), { ok: true, value: "Hello" });
  });
  it("invalid Base64 inside sentinel → ok: false", () => {
    const r = decodeHeaderValue("=?base64?!!!?=");
    assert.equal(r.ok, false);
  });
  it("missing closing sentinel → treated as literal", () => {
    assert.deepEqual(decodeHeaderValue("=?base64?SGVsbG8="), {
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
    assert.deepEqual(result, {
      "mcp-param-tenantid": "tenant_id",
      "mcp-param-region": "region",
    });
  });
  it("empty schema returns {}", () => {
    assert.deepEqual(collectExpectedHeaderParams({}), {});
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
    assert.deepEqual(result, { ok: true, args: { tenant_id: "acme", invoice_id: "inv-1" } });
  });

  it("body arg missing, header present → header injected", () => {
    const result = validateAndMergeHeaderParams(
      schema,
      { invoice_id: "inv-1" },
      { "mcp-param-tenantid": "acme" },
    );
    assert.deepEqual(result, { ok: true, args: { tenant_id: "acme", invoice_id: "inv-1" } });
  });

  it("body arg present, header absent → ok: false reason: header-missing", () => {
    const result = validateAndMergeHeaderParams(
      schema,
      { tenant_id: "acme", invoice_id: "inv-1" },
      {},
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "header-missing");
      assert.match(result.detail, /TenantId/);
    }
  });

  it("body arg present, header mismatches → ok: false reason: header-mismatch", () => {
    const result = validateAndMergeHeaderParams(
      schema,
      { tenant_id: "acme", invoice_id: "inv-1" },
      { "mcp-param-tenantid": "evil" },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "header-mismatch");
      assert.match(result.detail, /TenantId/);
    }
  });

  it("Base64-encoded header decoded before comparison", () => {
    const result = validateAndMergeHeaderParams(
      schema,
      { tenant_id: "Hello, 世界", invoice_id: "inv-1" },
      { "mcp-param-tenantid": "=?base64?SGVsbG8sIOS4lueVjA==?=" },
    );
    assert.deepEqual(result, { ok: true, args: { tenant_id: "Hello, 世界", invoice_id: "inv-1" } });
  });

  it("invalid Base64 → ok: false reason: invalid-base64", () => {
    const result = validateAndMergeHeaderParams(
      schema,
      { tenant_id: "x", invoice_id: "inv-1" },
      { "mcp-param-tenantid": "=?base64?!!!?=" },
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, "invalid-base64");
    }
  });

  it("schema has no x-mcp-header properties → trivially ok", () => {
    const result = validateAndMergeHeaderParams(
      { properties: { a: { type: "string" } } },
      { a: "1" },
      {},
    );
    assert.deepEqual(result, { ok: true, args: { a: "1" } });
  });
});
