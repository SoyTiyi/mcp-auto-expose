import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import type { RequestHandler } from "express";
import { mountMcpExpress } from "./express.js";
import type { McpHttpOptions } from "./createMcpHttp.js";

const TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const },
    tenant_id: { type: "string" as const, "x-mcp-header": true },
  },
  required: ["id"],
};

const TEST_TOOL = {
  name: "get_item",
  description: "Get an item by id",
  inputSchema: TOOL_SCHEMA,
  _source: { framework: "express" as const, method: "GET" as const, url: "/items/:id" },
};

type CallCapture = { tool: string; args: unknown; ctx: unknown };

function makeOpts(overrides?: Partial<McpHttpOptions>): McpHttpOptions & { calls: CallCapture[] } {
  const calls: CallCapture[] = [];
  return {
    name: "test-express",
    version: "0.0.0",
    tools: [TEST_TOOL],
    allowedOrigins: [],
    onToolCall: async (tool, args, ctx) => {
      calls.push({ tool: tool.name, args, ctx });
      return { content: [{ type: "text", text: "ok" }] };
    },
    ...overrides,
    calls,
  };
}

async function withExpressServer(
  opts: McpHttpOptions,
  authMiddleware: RequestHandler | null,
  fn: (baseUrl: string, close: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  if (authMiddleware) app.use(authMiddleware);
  const { router, close } = mountMcpExpress(opts);
  app.use(router);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await fn(baseUrl, close);
  } finally {
    await close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function postMcp(
  baseUrl: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
    return { status: res.status, body: parsed };
  } catch { /* not plain JSON */ }
  const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
  if (dataLine) {
    try { parsed = JSON.parse(dataLine.slice(6)); } catch { /* leave as text */ }
  }
  return { status: res.status, body: parsed };
}

async function initializeMcp(baseUrl: string): Promise<void> {
  await postMcp(
    baseUrl,
    {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    },
    { "Mcp-Method": "initialize" },
  );
}

describe("mountMcpExpress — routing", () => {
  it("POST initialize returns 200 and protocolVersion", async () => {
    const opts = makeOpts();
    await withExpressServer(opts, null, async (url) => {
      const { status, body } = await postMcp(
        url,
        {
          jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } },
        },
        { "Mcp-Method": "initialize" },
      );
      assert.equal(status, 200);
      const result = (body as { result?: { protocolVersion?: string } }).result;
      assert.ok(result?.protocolVersion, "expected protocolVersion in result");
    });
  });

  it("POST tools/list returns catalog after initialize", async () => {
    const opts = makeOpts();
    await withExpressServer(opts, null, async (url) => {
      await initializeMcp(url);
      const { status, body } = await postMcp(
        url,
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { "Mcp-Method": "tools/list" },
      );
      assert.equal(status, 200);
      const result = (body as { result?: { tools?: Array<{ name: string }> } }).result;
      const names = (result?.tools ?? []).map((t) => t.name);
      assert.ok(names.includes("get_item"), `expected get_item in ${JSON.stringify(names)}`);
    });
  });

  it("POST with method mismatch returns 400", async () => {
    const opts = makeOpts();
    await withExpressServer(opts, null, async (url) => {
      const { status, body } = await postMcp(
        url,
        { jsonrpc: "2.0", id: 3, method: "tools/list" },
        { "Mcp-Method": "tools/call" },
      );
      assert.equal(status, 400);
      assert.equal((body as Record<string, unknown>)["error"], "method-mismatch");
    });
  });

  it("POST with disallowed Origin returns 403", async () => {
    const opts = makeOpts({ allowedOrigins: ["https://app.local"] });
    await withExpressServer(opts, null, async (url) => {
      const { status } = await postMcp(
        url,
        { jsonrpc: "2.0", id: 4, method: "tools/list" },
        { "Mcp-Method": "tools/list", Origin: "https://evil.example" },
      );
      assert.equal(status, 403);
    });
  });
});

describe("mountMcpExpress — auth propagation", () => {
  it("req.auth set by prior middleware is available in ctx.auth", async () => {
    const opts = makeOpts();
    const authMiddleware: RequestHandler = (req, _res, next) => {
      (req as unknown as Record<string, unknown>)["auth"] = { sub: "u1" };
      next();
    };
    await withExpressServer(opts, authMiddleware, async (url) => {
      await initializeMcp(url);
      await postMcp(
        url,
        {
          jsonrpc: "2.0", id: 5, method: "tools/call",
          params: { name: "get_item", arguments: { id: "x" } },
        },
        { "Mcp-Method": "tools/call", "Mcp-Name": "get_item" },
      );
      const lastCall = opts.calls[opts.calls.length - 1];
      assert.ok(lastCall, "onToolCall should have been invoked");
      const ctx = lastCall.ctx as { auth?: { sub: string } };
      assert.deepEqual(ctx.auth, { sub: "u1" });
    });
  });
});

describe("mountMcpExpress — Mcp-Param header injection", () => {
  it("Mcp-Param-Tenant-Id populates ctx.headerParams and enriches args", async () => {
    const opts = makeOpts();
    await withExpressServer(opts, null, async (url) => {
      await initializeMcp(url);
      await postMcp(
        url,
        {
          jsonrpc: "2.0", id: 6, method: "tools/call",
          params: { name: "get_item", arguments: { id: "abc" } },
        },
        { "Mcp-Method": "tools/call", "Mcp-Name": "get_item", "Mcp-Param-Tenant-Id": "t42" },
      );
      const lastCall = opts.calls[opts.calls.length - 1];
      assert.ok(lastCall);
      const ctx = lastCall.ctx as { headerParams: Record<string, string> };
      assert.equal(ctx.headerParams["tenant_id"], "t42");
      assert.equal((lastCall.args as Record<string, unknown>)["tenant_id"], "t42");
    });
  });
});

describe("mountMcpExpress — GET SSE endpoint", () => {
  it("GET /mcp with Accept: text/event-stream does not return 4xx or 5xx", async () => {
    const opts = makeOpts();
    await withExpressServer(opts, null, async (url) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 500);
      try {
        const res = await fetch(`${url}/mcp`, {
          method: "GET",
          headers: { Accept: "text/event-stream" },
          signal: ctrl.signal,
        });
        assert.ok(res.status < 400, `expected <400 but got ${res.status}`);
        res.body?.cancel();
      } catch (err: unknown) {
        if ((err as { name?: string }).name !== "AbortError") throw err;
      } finally {
        clearTimeout(timer);
      }
    });
  });
});
