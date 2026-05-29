import { describe, it, expect } from "vitest";
import type {
  MCPTool,
  MCPToolInputSchema,
  RouteDescriptor,
  HTTPMethod,
  RouteSchema,
} from "./types.js";
import { INTERNAL_SOURCE } from "./internal.js";

describe("HTTPMethod", () => {
  it("accepts valid HTTP methods", () => {
    const methods: HTTPMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
    expect(methods.length).toBe(7);
    expect(methods[0]).toBe("GET");
  });
});

describe("MCPToolInputSchema", () => {
  it("accepts a valid MCPToolInputSchema shape", () => {
    const schema: MCPToolInputSchema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
    };
    expect(schema.type).toBe("object");
    expect(["name", "age"].every((k) => k in schema.properties)).toBeTruthy();
  });

  it("accepts schema with required fields", () => {
    const schema: MCPToolInputSchema = {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    };
    expect(schema.required?.length).toBe(1);
    expect(schema.required?.[0]).toBe("id");
  });
});

describe("RouteSchema", () => {
  it("accepts a valid RouteSchema shape", () => {
    const schema: RouteSchema = {
      body: { type: "object" },
      querystring: { page: { type: "number" } },
      params: { id: { type: "string" } },
      description: "Get a user by ID",
      summary: "Get user",
      tags: ["users"],
      hide: false,
    };
    expect(schema.description).toBe("Get a user by ID");
    expect(schema.summary).toBe("Get user");
    expect(schema.tags).toEqual(["users"]);
  });

  it("accepts RouteSchema with minimal fields", () => {
    const schema: RouteSchema = {
      description: "List all users",
    };
    expect(schema.description).toBe("List all users");
    expect(schema.querystring).toBe(undefined);
  });
});

describe("RouteDescriptor", () => {
  it("accepts a valid RouteDescriptor shape", () => {
    const descriptor: RouteDescriptor = {
      framework: "fastify",
      method: "GET",
      url: "/users",
    };
    expect(descriptor.framework).toBe("fastify");
    expect(descriptor.method).toBe("GET");
    expect(descriptor.url).toBe("/users");
  });

  it("accepts RouteDescriptor with schema", () => {
    const descriptor: RouteDescriptor = {
      framework: "express",
      method: "POST",
      url: "/users",
      schema: {
        body: { type: "object" },
        description: "Create a user",
      },
    };
    expect(descriptor.framework).toBe("express");
    expect(descriptor.schema?.description).toBe("Create a user");
  });
});

describe("MCPTool", () => {
  it("accepts a valid MCPTool shape", () => {
    const tool: MCPTool = {
      name: "list_users",
      description: "List all users",
      inputSchema: { type: "object", properties: {} },
      [INTERNAL_SOURCE]: { framework: "fastify", method: "GET", url: "/users", paramMap: {} },
    };
    expect(tool.name).toBe("list_users");
    expect(tool.description).toBe("List all users");
    expect(tool.inputSchema.type).toBe("object");
    const src1 = tool[INTERNAL_SOURCE]!;
    expect(src1.framework).toBe("fastify");
    expect(src1.method).toBe("GET");
    expect(src1.url).toBe("/users");
  });

  it("accepts MCPTool with complex inputSchema", () => {
    const tool: MCPTool = {
      name: "create_user",
      description: "Create a new user",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          age: { type: "number" },
        },
        required: ["name", "email"],
      },
      [INTERNAL_SOURCE]: {
        framework: "express",
        method: "POST",
        url: "/users",
        paramMap: { name: "body", email: "body" },
      },
    };
    expect(tool.inputSchema.required?.length).toBe(2);
    expect(tool[INTERNAL_SOURCE]!.method).toBe("POST");
  });
});
