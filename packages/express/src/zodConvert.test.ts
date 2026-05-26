import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { convertCached, specToRouteSchema } from "./zodConvert.js";
import { mcpHeader } from "./mcpHeader.js";

describe("convertCached", () => {
  it("z.object({ id: z.string() }) produces JSON Schema with type object and required id", () => {
    const schema = z.object({ id: z.string() });
    const result = convertCached(schema);
    assert.equal(result["type"], "object");
    const properties = result["properties"] as Record<string, unknown>;
    assert.ok(properties, "properties should exist");
    const id = properties["id"] as Record<string, unknown>;
    assert.equal(id["type"], "string");
    const required = result["required"] as string[];
    assert.ok(Array.isArray(required), "required should be an array");
    assert.ok(required.includes("id"), "required should contain 'id'");
  });

  it("z.string() produces JSON Schema with type string", () => {
    const schema = z.string();
    const result = convertCached(schema);
    assert.equal(result["type"], "string");
  });

  it("cache hit — same instance returns the same object reference", () => {
    const schema = z.object({ name: z.string() });
    const result1 = convertCached(schema);
    const result2 = convertCached(schema);
    assert.ok(Object.is(result1, result2), "should be the same reference");
  });
});

describe("mcpHeader annotation", () => {
  it("mcpHeader(z.string()) on a z.object property emits x-mcp-header with PascalCase fallback name", () => {
    const schema = z.object({ tenant_id: mcpHeader(z.string()) });
    const result = convertCached(schema);
    const props = result["properties"] as Record<string, Record<string, unknown>>;
    assert.equal(props["tenant_id"]?.["x-mcp-header"], "TenantId");
  });

  it("mcpHeader(z.string(), 'Region') emits the verbatim name", () => {
    const schema = z.object({ region: mcpHeader(z.string(), "Region") });
    const result = convertCached(schema);
    const props = result["properties"] as Record<string, Record<string, unknown>>;
    assert.equal(props["region"]?.["x-mcp-header"], "Region");
  });

  it("mcpHeader with .describe() preserves both description and the header name", () => {
    const schema = z.object({ tenant_id: mcpHeader(z.string().describe("Tenant from auth"), "TenantId") });
    const result = convertCached(schema);
    const props = result["properties"] as Record<string, Record<string, unknown>>;
    const prop = props["tenant_id"];
    assert.equal(prop?.["description"], "Tenant from auth");
    assert.equal(prop?.["x-mcp-header"], "TenantId");
  });

  it("a property WITHOUT mcpHeader() does NOT get x-mcp-header annotation", () => {
    const schema = z.object({
      tenant_id: mcpHeader(z.string(), "TenantId"),
      invoice_id: z.string(),
    });
    const result = convertCached(schema);
    const props = result["properties"] as Record<string, Record<string, unknown>>;
    assert.equal(props["tenant_id"]?.["x-mcp-header"], "TenantId");
    assert.equal(props["invoice_id"]?.["x-mcp-header"], undefined);
  });

  it("mcpHeader(z.number()) works on non-string primitive types", () => {
    const schema = z.object({ count: mcpHeader(z.number(), "Count") });
    const result = convertCached(schema);
    const props = result["properties"] as Record<string, Record<string, unknown>>;
    assert.equal(props["count"]?.["x-mcp-header"], "Count");
    assert.equal(props["count"]?.["type"], "number");
  });
});

describe("specToRouteSchema", () => {
  it("spec.query maps to RouteSchema.querystring, body is undefined", () => {
    const querySchema = z.object({ page: z.string() });
    const result = specToRouteSchema({ query: querySchema });
    assert.ok(result.querystring, "querystring should be populated");
    assert.equal(result.body, undefined);
  });

  it("spec.tags is a shallow copy — mutating original does not affect result", () => {
    const tags = ["t1", "t2"];
    const result = specToRouteSchema({ tags });
    tags.push("t3");
    assert.deepEqual(result.tags, ["t1", "t2"]);
  });

  it("spec.hide maps to RouteSchema.hide === true", () => {
    const result = specToRouteSchema({ hide: true });
    assert.equal(result.hide, true);
  });

  it("spec.description and spec.summary are passed through", () => {
    const result = specToRouteSchema({ description: "foo", summary: "bar" });
    assert.equal(result.description, "foo");
    assert.equal(result.summary, "bar");
  });
});
