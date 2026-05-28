import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reconstructRequest } from "./reconstructRequest.js";
import type { MCPTool } from "./types.js";

function makeTool(overrides: Partial<MCPTool> = {}): MCPTool {
  return {
    name: "test_tool",
    description: "test",
    inputSchema: { type: "object", properties: {} },
    _source: {
      framework: "express",
      method: "GET",
      url: "/users",
      paramMap: {},
    },
    ...overrides,
  };
}

describe("reconstructRequest", () => {
  it("1. GET /users/:id with {id:'123'} → substitutes URL, no body", () => {
    const tool = makeTool({
      _source: {
        framework: "express",
        method: "GET",
        url: "/users/:id",
        paramMap: { id: "params" },
      },
    });
    const result = reconstructRequest(tool, { id: "123" });
    assert.equal(result.url, "/users/123");
    assert.equal(result.querystring, "");
    assert.equal(result.body, undefined);
  });

  it("2. GET /users with querystring {format:'json'} → querystring built", () => {
    const tool = makeTool({
      _source: {
        framework: "express",
        method: "GET",
        url: "/users",
        paramMap: { format: "querystring" },
      },
    });
    const result = reconstructRequest(tool, { format: "json" });
    assert.equal(result.url, "/users");
    assert.equal(result.querystring, "?format=json");
    assert.equal(result.body, undefined);
  });

  it("3. POST /users with body {name, email} → body object returned", () => {
    const tool = makeTool({
      _source: {
        framework: "express",
        method: "POST",
        url: "/users",
        paramMap: { name: "body", email: "body" },
      },
    });
    const result = reconstructRequest(tool, { name: "Ana", email: "ana@test.com" });
    assert.equal(result.url, "/users");
    assert.equal(result.querystring, "");
    assert.deepEqual(result.body, { name: "Ana", email: "ana@test.com" });
  });

  it("4. URL param with special characters → encodeURIComponent applied", () => {
    const tool = makeTool({
      _source: {
        framework: "express",
        method: "GET",
        url: "/files/:path",
        paramMap: { path: "params" },
      },
    });
    const result = reconstructRequest(tool, { path: "folder/sub file" });
    assert.equal(result.url, "/files/folder%2Fsub%20file");
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
      _source: {
        framework: "express",
        method: "GET",
        url: "/users/:id",
        paramMap: { id: "params", tenant_id: "params" },
      },
    });
    const result = reconstructRequest(tool, { id: "u1", tenant_id: "acme" });
    assert.equal(result.url, "/users/u1");
    assert.equal(result.headers["Mcp-Param-TenantId"], "acme");
    assert.ok(!result.url.includes("acme"), "tenant_id must not appear in url");
    assert.equal(result.querystring, "");
  });

  it("6. params key with no :placeholder in URL → warns stderr + skips", () => {
    const originalWrite = process.stderr.write.bind(process.stderr);
    let stderrOutput = "";
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderrOutput += chunk.toString();
      return true;
    };

    const tool = makeTool({
      _source: {
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

    assert.ok(stderrOutput.includes("unbound-param"), "stderr should mention unbound-param");
    assert.equal(result.url, "/users/u1");
    assert.ok(!result.url.includes("phantom"), "unbound value must not appear in url");
  });

  it("7. GET method with body declared in paramMap → warns stderr + body undefined", () => {
    const originalWrite = process.stderr.write.bind(process.stderr);
    let stderrOutput = "";
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderrOutput += chunk.toString();
      return true;
    };

    const tool = makeTool({
      _source: {
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

    assert.ok(
      stderrOutput.includes("body-on-bodiless-method"),
      "stderr must warn about body on bodiless method",
    );
    assert.equal(result.body, undefined);
  });

  it("8. args not in paramMap → ignored silently", () => {
    const tool = makeTool({
      _source: {
        framework: "express",
        method: "GET",
        url: "/users",
        paramMap: {},
      },
    });
    const result = reconstructRequest(tool, { unknown: "value" });
    assert.equal(result.url, "/users");
    assert.equal(result.querystring, "");
    assert.equal(result.body, undefined);
  });

  it("9. {type:string} brace-style params substitution", () => {
    const tool = makeTool({
      _source: {
        framework: "fastify",
        method: "GET",
        url: "/users/{id}",
        paramMap: { id: "params" },
      },
    });
    const result = reconstructRequest(tool, { id: "123" });
    assert.equal(result.url, "/users/123");
  });
});
