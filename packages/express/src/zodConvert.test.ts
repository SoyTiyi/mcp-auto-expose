import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod/v3";
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
  it("mcpHeader(z.string()) on a z.object property produces x-mcp-header: true", () => {
    const schema = z.object({ tenant_id: mcpHeader(z.string()) });
    const result = convertCached(schema);
    const properties = result["properties"] as Record<string, Record<string, unknown>>;
    assert.ok(properties, "properties should exist");
    assert.equal(properties["tenant_id"]?.["x-mcp-header"], true);
  });

  it("mcpHeader with .describe() preserves both description and x-mcp-header", () => {
    const schema = z.object({ tenant_id: mcpHeader(z.string().describe("Tenant from auth")) });
    const result = convertCached(schema);
    const properties = result["properties"] as Record<string, Record<string, unknown>>;
    const prop = properties["tenant_id"];
    assert.ok(prop, "property should exist");
    assert.equal(prop["description"], "Tenant from auth");
    assert.equal(prop["x-mcp-header"], true);
  });

  it("a property WITHOUT mcpHeader() does NOT get x-mcp-header annotation", () => {
    const schema = z.object({
      tenant_id: mcpHeader(z.string()),
      invoice_id: z.string(),
    });
    const result = convertCached(schema);
    const properties = result["properties"] as Record<string, Record<string, unknown>>;
    assert.equal(properties["tenant_id"]?.["x-mcp-header"], true);
    assert.equal(properties["invoice_id"]?.["x-mcp-header"], undefined);
  });

  it("mcpHeader(z.number()) works on non-string types", () => {
    const schema = z.object({ count: mcpHeader(z.number()) });
    const result = convertCached(schema);
    const properties = result["properties"] as Record<string, Record<string, unknown>>;
    assert.equal(properties["count"]?.["x-mcp-header"], true);
    assert.equal(properties["count"]?.["type"], "number");
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
