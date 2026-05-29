import { describe, it, expect } from "vitest";
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
    expect(result.length).toBe(1);
    expect(result[0]?.method).toBe("GET");
    expect(result[0]?.url).toBe("/api/users");
    expect(result[0]?.framework).toBe("fastify");
  });

  it("returns 2 descriptors for an array of methods", () => {
    const result = adaptRouteOptions(
      makeRouteOptions({ method: ["GET", "POST"], url: "/api/items" }),
    );
    expect(result.length).toBe(2);
    const methods = result.map((d) => d.method);
    expect(methods.includes("GET")).toBeTruthy();
    expect(methods.includes("POST")).toBeTruthy();
    expect(result.every((d) => d.url === "/api/items")).toBeTruthy();
    expect(result.every((d) => d.framework === "fastify")).toBeTruthy();
  });

  it("returns empty array when schema.hide === true", () => {
    const result = adaptRouteOptions(
      makeRouteOptions({ schema: { hide: true } as unknown as RouteOptions["schema"] }),
    );
    expect(result).toEqual([]);
  });

  it("returns empty array when config.mcpExpose === false", () => {
    const result = adaptRouteOptions(makeRouteOptions({ config: { mcpExpose: false } }));
    expect(result).toEqual([]);
  });

  it("returns empty array when strictSchema: true and route has no body/querystring/params", () => {
    const result = adaptRouteOptions(
      makeRouteOptions({
        schema: { description: "just a description" } as unknown as RouteOptions["schema"],
      }),
      { strictSchema: true },
    );
    expect(result).toEqual([]);
  });

  it("returns descriptor when strictSchema: true and route has body schema", () => {
    const result = adaptRouteOptions(
      makeRouteOptions({
        schema: { body: { type: "object", properties: { name: { type: "string" } } } },
      }),
      { strictSchema: true },
    );
    expect(result.length).toBe(1);
    expect(result[0]?.method).toBe("GET");
  });

  it("returns descriptor (schema-less tools allowed) when strictSchema: false (default)", () => {
    const result = adaptRouteOptions(makeRouteOptions({ schema: undefined }));
    expect(result.length).toBe(1);
    expect(result[0]?.schema).toBe(undefined);
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
    expect(result.length).toBe(1);
    const schema = result[0]?.schema;
    expect(schema, "schema should be present").toBeTruthy();
    expect(schema!.body).toEqual(bodySchema);
    expect(schema!.params).toEqual(paramsSchema);
    expect(schema!.description).toBe("Get a user by ID");
    expect(schema!.tags).toEqual(["users"]);
  });

  it("filters out unsupported methods like PROPFIND", () => {
    const result = adaptRouteOptions(
      makeRouteOptions({ method: ["GET", "PROPFIND"] as RouteOptions["method"] }),
    );
    expect(result.length).toBe(1);
    expect(result[0]?.method).toBe("GET");
  });

  it("OPTIONS method is supported", () => {
    const result = adaptRouteOptions(
      makeRouteOptions({ method: "OPTIONS" as RouteOptions["method"], url: "/api/users" }),
    );
    expect(result.length).toBe(1);
    expect(result[0]?.method).toBe("OPTIONS");
    expect(result[0]?.url).toBe("/api/users");
  });

  it("HEAD method is excluded by default", () => {
    const result = adaptRouteOptions(
      makeRouteOptions({ method: "HEAD" as RouteOptions["method"], url: "/api/users" }),
    );
    expect(result).toEqual([]);
  });

  it("HEAD method is included when includeHead:true", () => {
    const result = adaptRouteOptions(
      makeRouteOptions({ method: "HEAD" as RouteOptions["method"], url: "/api/users" }),
      { includeHead: true },
    );
    expect(result.length).toBe(1);
    expect(result[0]?.method).toBe("HEAD");
    expect(result[0]?.url).toBe("/api/users");
    expect(result[0]?.framework).toBe("fastify");
  });
});
