import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { kebabize, unkebabize, extractHeaderParams, mergeHeaderParams } from "./headerParams.js";

describe("kebabize", () => {
  it('"tenant_id" → "Tenant-Id"', () => {
    assert.equal(kebabize("tenant_id"), "Tenant-Id");
  });

  it('"invoice_external_ref" → "Invoice-External-Ref"', () => {
    assert.equal(kebabize("invoice_external_ref"), "Invoice-External-Ref");
  });

  it('single word "name" → "Name"', () => {
    assert.equal(kebabize("name"), "Name");
  });
});

describe("unkebabize", () => {
  it('"mcp-param-tenant-id" → "tenant_id"', () => {
    assert.equal(unkebabize("mcp-param-tenant-id"), "tenant_id");
  });

  it('"mcp-param-invoice-external-ref" → "invoice_external_ref"', () => {
    assert.equal(unkebabize("mcp-param-invoice-external-ref"), "invoice_external_ref");
  });
});

describe("extractHeaderParams", () => {
  it('extracts "mcp-param-tenant-id" and ignores "content-type"', () => {
    const result = extractHeaderParams({
      "mcp-param-tenant-id": "t1",
      "content-type": "application/json",
    });
    assert.deepEqual(result, { tenant_id: "t1" });
  });

  it("returns {} when no mcp-param-* headers are present", () => {
    const result = extractHeaderParams({
      "content-type": "application/json",
      authorization: "Bearer xyz",
    });
    assert.deepEqual(result, {});
  });

  it("multi-value header (string[]) → takes first value", () => {
    const result = extractHeaderParams({
      "mcp-param-tenant-id": ["t1", "t2"],
    });
    assert.deepEqual(result, { tenant_id: "t1" });
  });
});

describe("mergeHeaderParams", () => {
  it("matching value in args and headerParams → returns that value, no warning", () => {
    const warnFn = (code: string) => {
      assert.fail(`unexpected warn call with code: ${code}`);
    };
    const schema = {
      properties: {
        tenant_id: { type: "string", "x-mcp-header": true },
      },
    };
    const result = mergeHeaderParams(schema, { tenant_id: "a" }, { tenant_id: "a" }, warnFn);
    assert.deepEqual(result, { tenant_id: "a" });
  });

  it("header param only (not in args) → injected into result", () => {
    const schema = {
      properties: {
        tenant_id: { type: "string", "x-mcp-header": true },
      },
    };
    const result = mergeHeaderParams(schema, {}, { tenant_id: "a" });
    assert.deepEqual(result, { tenant_id: "a" });
  });

  it("discrepancy between args and headerParams → uses header value and calls warnFn", () => {
    const warned: string[] = [];
    const warnFn = (code: string) => {
      warned.push(code);
    };
    const schema = {
      properties: {
        tenant_id: { type: "string", "x-mcp-header": true },
      },
    };
    const result = mergeHeaderParams(
      schema,
      { tenant_id: "a" },
      { tenant_id: "b" },
      warnFn,
    );
    assert.deepEqual(result, { tenant_id: "b" });
    assert.deepEqual(warned, ["header-body-mismatch"]);
  });

  it("property without x-mcp-header is NOT overridden by headerParams", () => {
    const schema = {
      properties: {
        user_id: { type: "string" },
      },
    };
    // Even if headerParams has user_id, it should not be injected because x-mcp-header is absent
    const result = mergeHeaderParams(
      schema,
      { user_id: "original" },
      { user_id: "from-header" },
    );
    assert.deepEqual(result, { user_id: "original" });
  });

  it("property with x-mcp-header not in headerParams → stays as-is from args", () => {
    const schema = {
      properties: {
        tenant_id: { type: "string", "x-mcp-header": true },
      },
    };
    const result = mergeHeaderParams(
      schema,
      { tenant_id: "from-args" },
      {},
    );
    assert.deepEqual(result, { tenant_id: "from-args" });
  });
});
