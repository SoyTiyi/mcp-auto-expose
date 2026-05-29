import { describe, it, expect } from "vitest";
import { reconstructRequest } from "./reconstructRequest.js";
import type { MCPTool } from "./types.js";
import { INTERNAL_SOURCE } from "./internal.js";
import type { InternalSource } from "./internal.js";

function makeTool(
  overrides: Partial<Omit<MCPTool, typeof INTERNAL_SOURCE>> & {
    source?: Partial<InternalSource>;
  } = {},
): MCPTool {
  const { source, ...rest } = overrides;
  return {
    name: "test_tool",
    description: "test",
    inputSchema: { type: "object", properties: {} },
    [INTERNAL_SOURCE]: {
      framework: "express",
      method: "GET",
      url: "/users",
      paramMap: {},
      ...source,
    },
    ...rest,
  };
}

describe("reconstructRequest", () => {
  it("1. GET /users/:id with {id:'123'} → substitutes URL, no body", () => {
    const tool = makeTool({
      source: {
        framework: "express",
        method: "GET",
        url: "/users/:id",
        paramMap: { id: "params" },
      },
    });
    const result = reconstructRequest(tool, { id: "123" });
    expect(result.url).toBe("/users/123");
    expect(result.querystring).toBe("");
    expect(result.body).toBe(undefined);
  });

  it("2. GET /users with querystring {format:'json'} → querystring built", () => {
    const tool = makeTool({
      source: {
        framework: "express",
        method: "GET",
        url: "/users",
        paramMap: { format: "querystring" },
      },
    });
    const result = reconstructRequest(tool, { format: "json" });
    expect(result.url).toBe("/users");
    expect(result.querystring).toBe("?format=json");
    expect(result.body).toBe(undefined);
  });

  it("3. POST /users with body {name, email} → body object returned", () => {
    const tool = makeTool({
      source: {
        framework: "express",
        method: "POST",
        url: "/users",
        paramMap: { name: "body", email: "body" },
      },
    });
    const result = reconstructRequest(tool, { name: "Ana", email: "ana@test.com" });
    expect(result.url).toBe("/users");
    expect(result.querystring).toBe("");
    expect(result.body).toEqual({ name: "Ana", email: "ana@test.com" });
  });

  it("4. URL param with special characters → encodeURIComponent applied", () => {
    const tool = makeTool({
      source: {
        framework: "express",
        method: "GET",
        url: "/files/:path",
        paramMap: { path: "params" },
      },
    });
    const result = reconstructRequest(tool, { path: "folder/sub file" });
    expect(result.url).toBe("/files/folder%2Fsub%20file");
  });

  it("5. x-mcp-header: string arg → goes to headers verbatim, NOT body/url/query", () => {
    const tool = makeTool({
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          tenant_id: { type: "string", "x-mcp-header": "TenantId" },
        },
      },
      source: {
        framework: "express",
        method: "GET",
        url: "/users/:id",
        paramMap: { id: "params", tenant_id: "params" },
      },
    });
    const result = reconstructRequest(tool, { id: "u1", tenant_id: "acme" });
    expect(result.url).toBe("/users/u1");
    expect(result.headers["Mcp-Param-TenantId"]).toBe("acme");
    expect(!result.url.includes("acme"), "tenant_id must not appear in url").toBeTruthy();
    expect(result.querystring).toBe("");
  });

  it("6. params key with no :placeholder in URL → warns stderr + skips", () => {
    const originalWrite = process.stderr.write.bind(process.stderr);
    let stderrOutput = "";
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderrOutput += chunk.toString();
      return true;
    };

    const tool = makeTool({
      source: {
        framework: "express",
        method: "GET",
        url: "/users/:id",
        paramMap: { id: "params", ghost: "params" },
      },
    });
    let result;
    try {
      result = reconstructRequest(tool, { id: "u1", ghost: "phantom" });
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(stderrOutput.includes("unbound-param"), "stderr should mention unbound-param").toBeTruthy();
    expect(result.url).toBe("/users/u1");
    expect(!result.url.includes("phantom"), "unbound value must not appear in url").toBeTruthy();
  });

  it("7. GET method with body declared in paramMap → warns stderr + body undefined", () => {
    const originalWrite = process.stderr.write.bind(process.stderr);
    let stderrOutput = "";
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderrOutput += chunk.toString();
      return true;
    };

    const tool = makeTool({
      source: {
        framework: "express",
        method: "GET",
        url: "/users",
        paramMap: { name: "body" },
      },
    });
    let result;
    try {
      result = reconstructRequest(tool, { name: "Ana" });
    } finally {
      process.stderr.write = originalWrite;
    }

    expect(
      stderrOutput.includes("body-on-bodiless-method"),
      "stderr must warn about body on bodiless method",
    ).toBeTruthy();
    expect(result.body).toBe(undefined);
  });

  it("8. args not in paramMap → ignored silently", () => {
    const tool = makeTool({
      source: {
        framework: "express",
        method: "GET",
        url: "/users",
        paramMap: {},
      },
    });
    const result = reconstructRequest(tool, { unknown: "value" });
    expect(result.url).toBe("/users");
    expect(result.querystring).toBe("");
    expect(result.body).toBe(undefined);
  });

  it("9. {type:string} brace-style params substitution", () => {
    const tool = makeTool({
      source: {
        framework: "fastify",
        method: "GET",
        url: "/users/{id}",
        paramMap: { id: "params" },
      },
    });
    const result = reconstructRequest(tool, { id: "123" });
    expect(result.url).toBe("/users/123");
  });
});
