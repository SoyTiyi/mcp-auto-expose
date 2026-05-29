import { describe, it, expect } from "vitest";
import type { RouteDescriptor } from "./types.js";
import { INTERNAL_SOURCE } from "./internal.js";
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
  it("1. with full schema — name, description from schema.description, inputSchema with params, INTERNAL_SOURCE correct", () => {
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

    expect(tool.name).toBe("get_users_by_id");
    expect(tool.description).toBe("Get a user by ID");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    });
    expect(tool[INTERNAL_SOURCE]!).toEqual({
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

    expect(tool.description).toBe("List all users");
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

    expect(tool.description).toBe("GET /api/users — auto-descubierto por mcp-auto-expose");
  });

  it("4. no schema at all — auto-generated description, inputSchema is empty object schema", () => {
    const descriptor = makeDescriptor({
      method: "GET",
      url: "/api/users",
    });

    const tool = resolveTool(descriptor);

    expect(tool.description).toBe("GET /api/users — auto-descubierto por mcp-auto-expose");
    expect(tool.inputSchema).toEqual({ type: "object", properties: {} });
    expect("required" in tool.inputSchema, "should have no 'required' key").toBeFalsy();
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

    expect(tool.name).toBe("create_users");
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
      },
      required: ["name", "email"],
    });
  });

  it("6. INTERNAL_SOURCE is correct — framework, method, url match descriptor", () => {
    const descriptor: RouteDescriptor = {
      framework: "express",
      method: "DELETE",
      url: "/api/items/:itemId",
    };

    const tool = resolveTool(descriptor);

    const src = tool[INTERNAL_SOURCE]!;
    expect(src.framework).toBe("express");
    expect(src.method).toBe("DELETE");
    expect(src.url).toBe("/api/items/:itemId");
  });
});
