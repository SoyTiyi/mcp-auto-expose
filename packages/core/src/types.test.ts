import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type {
  MCPTool,
  MCPToolInputSchema,
  RouteDescriptor,
  HTTPMethod,
  RouteSchema,
} from "./types.js";

describe("HTTPMethod", () => {
  it("accepts valid HTTP methods", () => {
    const methods: HTTPMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
    assert.equal(methods.length, 7);
    assert.equal(methods[0], "GET");
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
    assert.equal(schema.type, "object");
    assert.ok(["name", "age"].every((k) => k in schema.properties));
  });

  it("accepts schema with required fields", () => {
    const schema: MCPToolInputSchema = {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    };
    assert.equal(schema.required?.length, 1);
    assert.equal(schema.required?.[0], "id");
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
    assert.equal(schema.description, "Get a user by ID");
    assert.equal(schema.summary, "Get user");
    assert.deepEqual(schema.tags, ["users"]);
  });

  it("accepts RouteSchema with minimal fields", () => {
    const schema: RouteSchema = {
      description: "List all users",
    };
    assert.equal(schema.description, "List all users");
    assert.equal(schema.querystring, undefined);
  });
});

describe("RouteDescriptor", () => {
  it("accepts a valid RouteDescriptor shape", () => {
    const descriptor: RouteDescriptor = {
      framework: "fastify",
      method: "GET",
      url: "/users",
    };
    assert.equal(descriptor.framework, "fastify");
    assert.equal(descriptor.method, "GET");
    assert.equal(descriptor.url, "/users");
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
    assert.equal(descriptor.framework, "express");
    assert.equal(descriptor.schema?.description, "Create a user");
  });
});

describe("MCPTool", () => {
  it("accepts a valid MCPTool shape", () => {
    const tool: MCPTool = {
      name: "list_users",
      description: "List all users",
      inputSchema: { type: "object", properties: {} },
      _source: { framework: "fastify", method: "GET", url: "/users", paramMap: {} },
    };
    assert.equal(tool.name, "list_users");
    assert.equal(tool.description, "List all users");
    assert.equal(tool.inputSchema.type, "object");
    assert.equal(tool._source.framework, "fastify");
    assert.equal(tool._source.method, "GET");
    assert.equal(tool._source.url, "/users");
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
      _source: {
        framework: "express",
        method: "POST",
        url: "/users",
        paramMap: { name: "body", email: "body" },
      },
    };
    assert.equal(tool.inputSchema.required?.length, 2);
    assert.equal(tool._source.method, "POST");
  });
});
