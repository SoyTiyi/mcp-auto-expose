import { describe, it, expect } from "vitest";
import { z } from "zod";
import { convertCached, specToRouteSchema } from "./zodConvert.js";
import { mcpHeader } from "./mcpHeader.js";

describe("convertCached", () => {
  it("z.object({ id: z.string() }) produces JSON Schema with type object and required id", () => {
    const schema = z.object({ id: z.string() });
    const result = convertCached(schema);
    expect(result["type"]).toBe("object");
    const properties = result["properties"] as Record<string, unknown>;
    expect(properties, "properties should exist").toBeTruthy();
    const id = properties["id"] as Record<string, unknown>;
    expect(id["type"]).toBe("string");
    const required = result["required"] as string[];
    expect(Array.isArray(required), "required should be an array").toBeTruthy();
    expect(required.includes("id"), "required should contain 'id'").toBeTruthy();
  });

  it("z.string() produces JSON Schema with type string", () => {
    const schema = z.string();
    const result = convertCached(schema);
    expect(result["type"]).toBe("string");
  });

  it("cache hit — same instance returns the same object reference", () => {
    const schema = z.object({ name: z.string() });
    const result1 = convertCached(schema);
    const result2 = convertCached(schema);
    expect(Object.is(result1, result2), "should be the same reference").toBeTruthy();
  });
});

describe("mcpHeader annotation", () => {
  it("mcpHeader(z.string()) on a z.object property emits x-mcp-header with PascalCase fallback name", () => {
    const schema = z.object({ tenant_id: mcpHeader(z.string()) });
    const result = convertCached(schema);
    const props = result["properties"] as Record<string, Record<string, unknown>>;
    expect(props["tenant_id"]?.["x-mcp-header"]).toBe("TenantId");
  });

  it("mcpHeader(z.string(), 'Region') emits the verbatim name", () => {
    const schema = z.object({ region: mcpHeader(z.string(), "Region") });
    const result = convertCached(schema);
    const props = result["properties"] as Record<string, Record<string, unknown>>;
    expect(props["region"]?.["x-mcp-header"]).toBe("Region");
  });

  it("mcpHeader with .describe() preserves both description and the header name", () => {
    const schema = z.object({
      tenant_id: mcpHeader(z.string().describe("Tenant from auth"), "TenantId"),
    });
    const result = convertCached(schema);
    const props = result["properties"] as Record<string, Record<string, unknown>>;
    const prop = props["tenant_id"];
    expect(prop?.["description"]).toBe("Tenant from auth");
    expect(prop?.["x-mcp-header"]).toBe("TenantId");
  });

  it("a property WITHOUT mcpHeader() does NOT get x-mcp-header annotation", () => {
    const schema = z.object({
      tenant_id: mcpHeader(z.string(), "TenantId"),
      invoice_id: z.string(),
    });
    const result = convertCached(schema);
    const props = result["properties"] as Record<string, Record<string, unknown>>;
    expect(props["tenant_id"]?.["x-mcp-header"]).toBe("TenantId");
    expect(props["invoice_id"]?.["x-mcp-header"]).toBe(undefined);
  });

  it("mcpHeader(z.number()) works on non-string primitive types", () => {
    const schema = z.object({ count: mcpHeader(z.number(), "Count") });
    const result = convertCached(schema);
    const props = result["properties"] as Record<string, Record<string, unknown>>;
    expect(props["count"]?.["x-mcp-header"]).toBe("Count");
    expect(props["count"]?.["type"]).toBe("number");
  });
});

describe("specToRouteSchema", () => {
  it("spec.query maps to RouteSchema.querystring, body is undefined", () => {
    const querySchema = z.object({ page: z.string() });
    const result = specToRouteSchema({ query: querySchema });
    expect(result.querystring, "querystring should be populated").toBeTruthy();
    expect(result.body).toBe(undefined);
  });

  it("spec.tags is a shallow copy — mutating original does not affect result", () => {
    const tags = ["t1", "t2"];
    const result = specToRouteSchema({ tags });
    tags.push("t3");
    expect(result.tags).toEqual(["t1", "t2"]);
  });

  it("spec.hide maps to RouteSchema.hide === true", () => {
    const result = specToRouteSchema({ hide: true });
    expect(result.hide).toBe(true);
  });

  it("spec.description and spec.summary are passed through", () => {
    const result = specToRouteSchema({ description: "foo", summary: "bar" });
    expect(result.description).toBe("foo");
    expect(result.summary).toBe("bar");
  });
});
