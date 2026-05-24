import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { RouteDescriptor } from "./types.js";
import { resolveTool } from "./resolveTool.js";

function makeDescriptor(overrides: Partial<RouteDescriptor> = {}): RouteDescriptor {
  return {
    framework: "fastify",
    method: "GET",
    url: "/api/users",
    ...overrides,
  };
}

describe("resolveTool", () => {
  it("1. with full schema — name, description from schema.description, inputSchema with params, _source correct", () => {
    const descriptor = makeDescriptor({
      method: "GET",
      url: "/api/users/:id",
      schema: {
        description: "Get a user by ID",
        params: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
    });

    const tool = resolveTool(descriptor);

    assert.equal(tool.name, "get_users_by_id");
    assert.equal(tool.description, "Get a user by ID");
    assert.deepEqual(tool.inputSchema, {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    });
    assert.deepEqual(tool._source, {
      framework: "fastify",
      method: "GET",
      url: "/api/users/:id",
      paramMap: { id: "params" },
    });
  });

  it("2. summary fallback — schema has no description but has summary", () => {
    const descriptor = makeDescriptor({
      schema: {
        summary: "List all users",
      },
    });

    const tool = resolveTool(descriptor);

    assert.equal(tool.description, "List all users");
  });

  it("3. auto-description fallback — schema has neither description nor summary", () => {
    const descriptor = makeDescriptor({
      method: "GET",
      url: "/api/users",
      schema: {
        tags: ["users"],
      },
    });

    const tool = resolveTool(descriptor);

    assert.equal(
      tool.description,
      "GET /api/users — auto-descubierto por mcp-auto-expose",
    );
  });

  it("4. no schema at all — auto-generated description, inputSchema is empty object schema", () => {
    const descriptor = makeDescriptor({
      method: "GET",
      url: "/api/users",
    });

    const tool = resolveTool(descriptor);

    assert.equal(
      tool.description,
      "GET /api/users — auto-descubierto por mcp-auto-expose",
    );
    assert.deepEqual(tool.inputSchema, { type: "object", properties: {} });
    assert.ok(!("required" in tool.inputSchema), "should have no 'required' key");
  });

  it("5. POST with body schema — inputSchema has body properties", () => {
    const descriptor = makeDescriptor({
      method: "POST",
      url: "/api/users",
      schema: {
        body: {
          type: "object",
          properties: {
            name: { type: "string" },
            email: { type: "string" },
          },
          required: ["name", "email"],
        },
      },
    });

    const tool = resolveTool(descriptor);

    assert.equal(tool.name, "create_users");
    assert.deepEqual(tool.inputSchema, {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
      },
      required: ["name", "email"],
    });
  });

  it("6. _source is correct — framework, method, url match descriptor", () => {
    const descriptor: RouteDescriptor = {
      framework: "express",
      method: "DELETE",
      url: "/api/items/:itemId",
    };

    const tool = resolveTool(descriptor);

    assert.equal(tool._source.framework, "express");
    assert.equal(tool._source.method, "DELETE");
    assert.equal(tool._source.url, "/api/items/:itemId");
  });
});
