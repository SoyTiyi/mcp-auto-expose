import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createMcpHttp } from "./createMcpHttp.js";
import type { McpHttpOptions, McpIncomingMessage } from "./createMcpHttp.js";

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
    name: "test-server",
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

async function withServer(
  opts: McpHttpOptions,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const handle = createMcpHttp(opts);

  const server = http.createServer(async (req, res) => {
    const mcpReq = req as McpIncomingMessage;
    // Body parse for POST
    if (req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      if (chunks.length > 0) {
        try {
          mcpReq.body = JSON.parse(Buffer.concat(chunks).toString());
        } catch {
          mcpReq.body = undefined;
        }
      }
    }
    await handle.handleNodeRequest(mcpReq, res);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await fn(baseUrl);
  } finally {
    await handle.close();
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
  // SSE format: extract first "data: <json>" line
  const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
  if (dataLine) {
    try {
      parsed = JSON.parse(dataLine.slice(6));
    } catch { /* leave as text */ }
  }
  return { status: res.status, body: parsed };
}

async function initializeMcp(baseUrl: string): Promise<void> {
  await postMcp(
    baseUrl,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
    },
    { "Mcp-Method": "initialize" },
  );
}

describe("createMcpHttp — origin guard", () => {
  it("POST with disallowed Origin returns 403", async () => {
    const opts = makeOpts({ allowedOrigins: ["https://app.local"] });
    await withServer(opts, async (url) => {
      const res = await fetch(`${url}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example",
          "Mcp-Method": "tools/list",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      assert.equal(res.status, 403);
    });
  });

  it("POST without Origin passes when allowedOrigins is []", async () => {
    const opts = makeOpts();
    await withServer(opts, async (url) => {
      const { status } = await postMcp(
        url,
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
        { "Mcp-Method": "initialize" },
      );
      assert.notEqual(status, 403);
    });
  });
});

describe("createMcpHttp — SEP-2243 guard", () => {
  it("POST with mcp-method/body mismatch returns 400", async () => {
    const opts = makeOpts({ requireSep2243: true });
    await withServer(opts, async (url) => {
      const { status, body } = await postMcp(
        url,
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { "Mcp-Method": "tools/call" },
      );
      assert.equal(status, 400);
      assert.equal((body as Record<string, unknown>)["error"], "method-mismatch");
    });
  });

  it("POST without Mcp-Method returns 400", async () => {
    const opts = makeOpts({ requireSep2243: true });
    await withServer(opts, async (url) => {
      const { status } = await postMcp(url, {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });
      assert.equal(status, 400);
    });
  });
});

describe("createMcpHttp — MCP roundtrip", () => {
  it("tools/list returns the provisioned tool catalog", async () => {
    const opts = makeOpts();
    await withServer(opts, async (url) => {
      await initializeMcp(url);
      const { status, body } = await postMcp(
        url,
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        { "Mcp-Method": "tools/list" },
      );
      assert.equal(status, 200);
      const result = body as { result?: { tools?: Array<{ name: string }> } };
      const names = (result.result?.tools ?? []).map((t) => t.name);
      assert.ok(names.includes("get_item"), `expected get_item in ${JSON.stringify(names)}`);
    });
  });

  it("tools/call invokes onToolCall with correct args", async () => {
    const opts = makeOpts();
    await withServer(opts, async (url) => {
      await initializeMcp(url);
      await postMcp(
        url,
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "get_item", arguments: { id: "abc" } },
        },
        { "Mcp-Method": "tools/call", "Mcp-Name": "get_item" },
      );
      const lastCall = opts.calls[opts.calls.length - 1];
      assert.ok(lastCall, "onToolCall should have been called");
      assert.equal(lastCall.tool, "get_item");
      assert.deepEqual((lastCall.args as Record<string, unknown>)["id"], "abc");
    });
  });

  it("ctx.mcp.method and ctx.mcp.name are populated on tools/call", async () => {
    const opts = makeOpts();
    await withServer(opts, async (url) => {
      await initializeMcp(url);
      await postMcp(
        url,
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "get_item", arguments: { id: "x" } },
        },
        { "Mcp-Method": "tools/call", "Mcp-Name": "get_item" },
      );
      const lastCall = opts.calls[opts.calls.length - 1];
      assert.ok(lastCall);
      const ctx = lastCall.ctx as { mcp: { method: string; name: string } };
      assert.equal(ctx.mcp.method, "tools/call");
      assert.equal(ctx.mcp.name, "get_item");
    });
  });

  it("Mcp-Param-Tenant-Id populates ctx.headerParams.tenant_id and enriches args", async () => {
    const opts = makeOpts();
    await withServer(opts, async (url) => {
      await initializeMcp(url);
      await postMcp(
        url,
        {
          jsonrpc: "2.0",
          id: 5,
          method: "tools/call",
          params: { name: "get_item", arguments: { id: "abc" } },
        },
        {
          "Mcp-Method": "tools/call",
          "Mcp-Name": "get_item",
          "Mcp-Param-Tenant-Id": "t1",
        },
      );
      const lastCall = opts.calls[opts.calls.length - 1];
      assert.ok(lastCall);
      const ctx = lastCall.ctx as { headerParams: Record<string, string> };
      assert.equal(ctx.headerParams["tenant_id"], "t1");
      assert.equal((lastCall.args as Record<string, unknown>)["tenant_id"], "t1");
    });
  });

  it("close() resolves without error", async () => {
    const opts = makeOpts();
    const handle = createMcpHttp(opts);
    await assert.doesNotReject(() => handle.close());
  });
});
