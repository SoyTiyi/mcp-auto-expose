import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { INTERNAL_SOURCE } from "@mcp-auto-expose/core/internal";
import { mcpFastifyPlugin } from "./fastify.js";
import type { McpHttpOptions } from "./createMcpHttp.js";

const TOOL_SCHEMA = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const },
    tenant_id: { type: "string" as const, "x-mcp-header": "TenantId" },
  },
  required: ["id"],
};

const TEST_TOOL = {
  name: "get_item",
  description: "Get an item by id",
  inputSchema: TOOL_SCHEMA,
  [INTERNAL_SOURCE]: {
    framework: "express" as const,
    method: "GET" as const,
    url: "/items/:id",
    paramMap: { id: "params" as const, tenant_id: "params" as const },
  },
};

type CallCapture = { tool: string; args: unknown; ctx: unknown };

function makeOpts(overrides?: Partial<McpHttpOptions>): McpHttpOptions & { calls: CallCapture[] } {
  const calls: CallCapture[] = [];
  return {
    name: "test-fastify",
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

function parseMcpBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    /* not JSON */
  }
  const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
  if (dataLine) {
    try {
      return JSON.parse(dataLine.slice(6));
    } catch {
      /* not JSON */
    }
  }
  return text;
}

async function injectPost(
  fastify: ReturnType<typeof Fastify>,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fastify.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v])),
    },
    body: JSON.stringify(body),
  });
  return { status: res.statusCode, body: parseMcpBody(res.body) };
}

async function initializeMcp(fastify: ReturnType<typeof Fastify>): Promise<void> {
  await injectPost(
    fastify,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    },
    { "Mcp-Method": "initialize" },
  );
}

describe("mcpFastifyPlugin — routing", () => {
  it("POST initialize returns 200 and protocolVersion", async () => {
    const opts = makeOpts();
    const fastify = Fastify({ logger: false });
    await fastify.register(mcpFastifyPlugin, opts);
    await fastify.ready();
    const { status, body } = await injectPost(
      fastify,
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "t", version: "0" },
        },
      },
      { "Mcp-Method": "initialize" },
    );
    assert.equal(status, 200);
    const result = (body as { result?: { protocolVersion?: string } }).result;
    assert.ok(result?.protocolVersion, "expected protocolVersion in result");
    await fastify.close();
  });

  it("POST tools/list after initialize returns catalog", async () => {
    const opts = makeOpts();
    const fastify = Fastify({ logger: false });
    await fastify.register(mcpFastifyPlugin, opts);
    await fastify.ready();
    await initializeMcp(fastify);
    const { status, body } = await injectPost(
      fastify,
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { "Mcp-Method": "tools/list" },
    );
    assert.equal(status, 200);
    const result = (body as { result?: { tools?: Array<{ name: string }> } }).result;
    const names = (result?.tools ?? []).map((t) => t.name);
    assert.ok(names.includes("get_item"), `expected get_item in ${JSON.stringify(names)}`);
    await fastify.close();
  });

  it("POST with method mismatch returns 400", async () => {
    const opts = makeOpts({ requireSep2243: true });
    const fastify = Fastify({ logger: false });
    await fastify.register(mcpFastifyPlugin, opts);
    await fastify.ready();
    const { status, body } = await injectPost(
      fastify,
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { "Mcp-Method": "tools/call" },
    );
    assert.equal(status, 400);
    const parsedBody = body as { error?: { code: number; message: string } };
    assert.equal(parsedBody.error?.code, -32001);
    assert.equal(parsedBody.error?.message, "HeaderMismatch");
    await fastify.close();
  });

  it("POST with disallowed Origin returns 403", async () => {
    const opts = makeOpts({ allowedOrigins: ["https://app.local"] });
    const fastify = Fastify({ logger: false });
    await fastify.register(mcpFastifyPlugin, opts);
    await fastify.ready();
    const { status } = await injectPost(
      fastify,
      { jsonrpc: "2.0", id: 4, method: "tools/list" },
      { "Mcp-Method": "tools/list", Origin: "https://evil.example" },
    );
    assert.equal(status, 403);
    await fastify.close();
  });
});

describe("mcpFastifyPlugin — auth propagation", () => {
  it("auth set on request.raw by a preHandler is available in ctx.auth", async () => {
    const opts = makeOpts();
    const fastify = Fastify({ logger: false });
    await fastify.register(mcpFastifyPlugin, opts);
    fastify.addHook("preHandler", async (request) => {
      (request.raw as unknown as Record<string, unknown>)["auth"] = { sub: "u1" };
    });
    await fastify.ready();
    await initializeMcp(fastify);
    await injectPost(
      fastify,
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "get_item", arguments: { id: "x" } },
      },
      { "Mcp-Method": "tools/call", "Mcp-Name": "get_item" },
    );
    const lastCall = opts.calls[opts.calls.length - 1];
    assert.ok(lastCall, "onToolCall should have been invoked");
    const ctx = lastCall.ctx as { auth?: { sub: string } };
    assert.deepEqual(ctx.auth, { sub: "u1" });
    await fastify.close();
  });
});

describe("mcpFastifyPlugin — Mcp-Param header injection", () => {
  it("Mcp-Param-TenantId populates ctx.headerParams and enriches args", async () => {
    const opts = makeOpts();
    const fastify = Fastify({ logger: false });
    await fastify.register(mcpFastifyPlugin, opts);
    await fastify.ready();
    await initializeMcp(fastify);
    await injectPost(
      fastify,
      {
        jsonrpc: "2.0",
        id: 6,
        method: "tools/call",
        params: { name: "get_item", arguments: { id: "abc" } },
      },
      { "Mcp-Method": "tools/call", "Mcp-Name": "get_item", "Mcp-Param-TenantId": "t99" },
    );
    const lastCall = opts.calls[opts.calls.length - 1];
    assert.ok(lastCall);
    const ctx = lastCall.ctx as { headerParams: Record<string, string> };
    assert.equal(ctx.headerParams["tenant_id"], "t99");
    assert.equal((lastCall.args as Record<string, unknown>)["tenant_id"], "t99");
    await fastify.close();
  });
});

describe("mcpFastifyPlugin — GET SSE endpoint", () => {
  it("GET /mcp with Accept: text/event-stream does not return 4xx or 5xx", async () => {
    const opts = makeOpts();
    const fastify = Fastify({ logger: false });
    await fastify.register(mcpFastifyPlugin, opts);
    // Bind to a real port so we can send a real SSE request (inject() hangs on open streams)
    await fastify.listen({ port: 0, host: "127.0.0.1" });
    const address = fastify.server.address() as import("node:net").AddressInfo;
    const url = `http://127.0.0.1:${address.port}/mcp`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 500);
    try {
      const res = await fetch(url, {
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
    await fastify.close();
  });
});
