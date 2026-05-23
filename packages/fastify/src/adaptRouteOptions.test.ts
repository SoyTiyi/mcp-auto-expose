import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { RouteOptions } from "fastify";
import { adaptRouteOptions } from "./adaptRouteOptions.js";

function makeRouteOptions(overrides: Partial<RouteOptions> = {}): RouteOptions {
  return {
    method: "GET",
    url: "/api/users",
    handler: async () => ({}),
    ...overrides,
  } as RouteOptions;
}

describe("adaptRouteOptions", () => {
  it("returns 1 descriptor for a single method string", () => {
    const result = adaptRouteOptions(makeRouteOptions({ method: "GET", url: "/api/users" }));
    assert.equal(result.length, 1);
    assert.equal(result[0]?.method, "GET");
    assert.equal(result[0]?.url, "/api/users");
    assert.equal(result[0]?.framework, "fastify");
  });

  it("returns 2 descriptors for an array of methods", () => {
    const result = adaptRouteOptions(
      makeRouteOptions({ method: ["GET", "POST"], url: "/api/items" }),
    );
    assert.equal(result.length, 2);
    const methods = result.map((d) => d.method);
    assert.ok(methods.includes("GET"));
    assert.ok(methods.includes("POST"));
    assert.ok(result.every((d) => d.url === "/api/items"));
    assert.ok(result.every((d) => d.framework === "fastify"));
  });

  it("returns empty array when schema.hide === true", () => {
    const result = adaptRouteOptions(
      makeRouteOptions({ schema: { hide: true } as unknown as RouteOptions["schema"] }),
    );
    assert.deepEqual(result, []);
  });

  it("returns empty array when config.mcpExpose === false", () => {
    const result = adaptRouteOptions(
      makeRouteOptions({ config: { mcpExpose: false } }),
    );
    assert.deepEqual(result, []);
  });

  it("returns empty array when strictSchema: true and route has no body/querystring/params", () => {
    const result = adaptRouteOptions(
      makeRouteOptions({
        schema: { description: "just a description" } as unknown as RouteOptions["schema"],
      }),
      { strictSchema: true },
    );
    assert.deepEqual(result, []);
  });

  it("returns descriptor when strictSchema: true and route has body schema", () => {
    const result = adaptRouteOptions(
      makeRouteOptions({
        schema: { body: { type: "object", properties: { name: { type: "string" } } } },
      }),
      { strictSchema: true },
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]?.method, "GET");
  });

  it("returns descriptor (schema-less tools allowed) when strictSchema: false (default)", () => {
    const result = adaptRouteOptions(makeRouteOptions({ schema: undefined }));
    assert.equal(result.length, 1);
    assert.equal(result[0]?.schema, undefined);
  });

  it("copies schema fields correctly into RouteDescriptor", () => {
    const bodySchema = { type: "object", properties: { id: { type: "number" } } };
    const paramsSchema = { type: "object", properties: { userId: { type: "string" } } };

    const result = adaptRouteOptions(
      makeRouteOptions({
        schema: {
          description: "Get a user by ID",
          body: bodySchema,
          params: paramsSchema,
          tags: ["users"],
        } as unknown as RouteOptions["schema"],
      }),
    );
    assert.equal(result.length, 1);
    const schema = result[0]?.schema;
    assert.ok(schema, "schema should be present");
    assert.deepEqual(schema.body, bodySchema);
    assert.deepEqual(schema.params, paramsSchema);
    assert.equal(schema.description, "Get a user by ID");
    assert.deepEqual(schema.tags, ["users"]);
  });

  it("filters out unsupported methods like PROPFIND", () => {
    const result = adaptRouteOptions(
      makeRouteOptions({ method: ["GET", "PROPFIND"] as RouteOptions["method"] }),
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]?.method, "GET");
  });

  it("OPTIONS method is supported", () => {
    const result = adaptRouteOptions(
      makeRouteOptions({ method: "OPTIONS" as RouteOptions["method"], url: "/api/users" }),
    );
    assert.equal(result.length, 1);
    assert.equal(result[0]?.method, "OPTIONS");
    assert.equal(result[0]?.url, "/api/users");
  });

  it("HEAD method is excluded", () => {
    const result = adaptRouteOptions(
      makeRouteOptions({ method: "HEAD" as RouteOptions["method"], url: "/api/users" }),
    );
    assert.deepEqual(result, []);
  });
});
