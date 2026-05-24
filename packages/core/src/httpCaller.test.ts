import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import { makeHttpCaller } from "./httpCaller.js";
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

interface TestRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function startTestServer(
  handler: (req: TestRequest) => { status: number; body: string },
): Promise<{ baseUrl: string; close: () => Promise<void>; lastRequest: () => TestRequest | undefined }> {
  let lastReq: TestRequest | undefined;

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let rawBody = "";
      req.on("data", (chunk: Buffer) => { rawBody += chunk.toString(); });
      req.on("end", () => {
        const testReq: TestRequest = {
          method: req.method ?? "",
          url: req.url ?? "",
          headers: req.headers,
          body: rawBody,
        };
        lastReq = testReq;
        const { status, body } = handler(testReq);
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(body);
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r())),
        lastRequest: () => lastReq,
      });
    });
  });
}

describe("makeHttpCaller", () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let lastRequest: () => TestRequest | undefined;

  before(async () => {
    ({ baseUrl, close: closeServer, lastRequest } = await startTestServer((req) => {
      if (req.url === "/error") return { status: 500, body: JSON.stringify({ error: "internal" }) };
      if (req.url === "/users") return { status: 200, body: JSON.stringify([{ id: "u1" }]) };
      if (req.url?.startsWith("/users/")) return { status: 200, body: JSON.stringify({ id: req.url.split("/").pop() }) };
      return { status: 200, body: JSON.stringify({ ok: true }) };
    }));
  });

  after(async () => {
    await closeServer();
  });

  it("1. GET with URL params → correct URL, returns backend data", async () => {
    const caller = makeHttpCaller({ baseUrl });
    const tool = makeTool({
      _source: {
        framework: "express",
        method: "GET",
        url: "/users/:id",
        paramMap: { id: "params" },
      },
    });
    const result = await caller(tool, { id: "u1" });
    assert.equal(result.isError, undefined);
    const req = lastRequest()!;
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/users/u1");
    assert.ok(result.content[0]?.text.includes("u1"), "response contains id");
  });

  it("2. POST with body → JSON sent correctly", async () => {
    const caller = makeHttpCaller({ baseUrl });
    const tool = makeTool({
      _source: {
        framework: "express",
        method: "POST",
        url: "/users",
        paramMap: { name: "body", email: "body" },
      },
    });
    await caller(tool, { name: "Ana", email: "ana@test.com" });
    const req = lastRequest()!;
    assert.equal(req.method, "POST");
    assert.equal(req.headers["content-type"], "application/json");
    const parsed = JSON.parse(req.body) as { name: string; email: string };
    assert.equal(parsed.name, "Ana");
    assert.equal(parsed.email, "ana@test.com");
  });

  it("3. Backend returns non-OK → isError: true", async () => {
    const caller = makeHttpCaller({ baseUrl });
    const tool = makeTool({
      _source: {
        framework: "express",
        method: "GET",
        url: "/error",
        paramMap: {},
      },
    });
    const result = await caller(tool, {});
    assert.equal(result.isError, true);
    assert.ok(result.content[0]?.text.includes("internal"), "error text in response");
  });

  it("4. Timeout → isError: true", async () => {
    const hangServer = http.createServer((_req, _res) => { /* intentionally never responds */ });
    const hangBaseUrl = await new Promise<string>((resolve) => {
      hangServer.listen(0, "127.0.0.1", () => {
        const addr = hangServer.address() as { port: number };
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    });
    try {
      const caller = makeHttpCaller({ baseUrl: hangBaseUrl, timeoutMs: 50 });
      const tool = makeTool({
        _source: { framework: "express", method: "GET", url: "/users", paramMap: {} },
      });
      const result = await caller(tool, {});
      assert.equal(result.isError, true);
      assert.ok((result.content[0]?.text ?? "").length > 0, "error text present");
    } finally {
      await new Promise<void>((r) => hangServer.close(() => r()));
    }
  });

  it("5. x-mcp-header arg → arrives as Mcp-Param-* header at backend", async () => {
    const caller = makeHttpCaller({ baseUrl });
    const tool = makeTool({
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          tenant_id: { type: "string", "x-mcp-header": true },
        },
      },
      _source: {
        framework: "express",
        method: "GET",
        url: "/users/:id",
        paramMap: { id: "params", tenant_id: "params" },
      },
    });
    await caller(tool, { id: "u1", tenant_id: "acme" });
    const req = lastRequest()!;
    assert.equal(req.headers["mcp-param-tenant-id"], "acme");
    assert.equal(req.url, "/users/u1");
  });

  it("6. defaultHeaders forwarded to every request", async () => {
    const caller = makeHttpCaller({
      baseUrl,
      defaultHeaders: { Authorization: "Bearer token123" },
    });
    const tool = makeTool({
      _source: { framework: "express", method: "GET", url: "/users", paramMap: {} },
    });
    await caller(tool, {});
    const req = lastRequest()!;
    assert.equal(req.headers["authorization"], "Bearer token123");
  });
});
