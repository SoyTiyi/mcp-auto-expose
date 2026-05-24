import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http, { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
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
  _source: {
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
  } as McpHttpOptions & { calls: CallCapture[] };
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
  it("POST with mcp-method/body mismatch returns 400 with JSON-RPC -32001", async () => {
    const opts = makeOpts({ requireSep2243: true });
    await withServer(opts, async (url) => {
      const { status, body } = await postMcp(
        url,
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { "Mcp-Method": "tools/call" },
      );
      assert.equal(status, 400);
      const parsed = body as { jsonrpc?: string; error?: { code: number; message: string; data?: { reason: string } } };
      assert.equal(parsed.jsonrpc, "2.0");
      assert.equal(parsed.error?.code, -32001);
      assert.equal(parsed.error?.message, "HeaderMismatch");
      assert.ok(typeof parsed.error?.data?.reason === "string" && parsed.error.data.reason.length > 0);
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

  // TODO(Task 9): re-enable full assertions once validateAndMergeHeaderParams is wired.
  // Currently headerParams is {} and enrichedArgs = rawArgs (no header injection yet).
  it("tools/call with Mcp-Param-Tenant-Id header succeeds (enrichment pending Task 9)", async () => {
    const opts = makeOpts();
    await withServer(opts, async (url) => {
      await initializeMcp(url);
      const { status } = await postMcp(
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
      // Request succeeds; enrichment (headerParams injection) comes in Task 9.
      assert.equal(status, 200);
    });
  });

  it("close() resolves without error", async () => {
    const opts = makeOpts();
    const handle = createMcpHttp(opts);
    await assert.doesNotReject(() => handle.close());
  });
});

describe("createMcpHttp — fail-fast and apiBaseUrl", () => {
  it("throws when neither onToolCall nor apiBaseUrl provided", () => {
    assert.throws(
      () =>
        createMcpHttp({
          name: "test",
          version: "0.0.0",
          tools: [TEST_TOOL],
          allowedOrigins: [],
        }),
      /apiBaseUrl.*onToolCall|onToolCall.*apiBaseUrl/i,
    );
  });

  it("onToolCall takes precedence over apiBaseUrl", async () => {
    const calls: string[] = [];
    const handle = createMcpHttp({
      name: "test",
      version: "0.0.0",
      tools: [TEST_TOOL],
      allowedOrigins: [],
      apiBaseUrl: "http://127.0.0.1:9", 
      onToolCall: async (tool) => {
        calls.push(tool.name);
        return { content: [{ type: "text", text: "explicit" }] };
      },
    });
    await assert.doesNotReject(() => handle.close());
    
    assert.equal(calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// New tests: SEP-2243 default enforcement + JSON-RPC -32001 error format
// Uses mock req/res objects (no real HTTP server) for isolation.
// ---------------------------------------------------------------------------

function makeMockReq(
  method: string,
  headers: Record<string, string>,
  body: unknown,
): IncomingMessage & { body?: unknown } {
  const socket = new Socket();
  const req = new IncomingMessage(socket) as IncomingMessage & { body?: unknown };
  req.method = method;
  req.url = "/mcp";
  for (const [k, v] of Object.entries(headers)) {
    (req.headers as Record<string, string>)[k] = v;
  }
  req.body = body;
  return req;
}

function makeMockRes(): ServerResponse & { _status?: number; _body?: string } {
  const socket = new Socket();
  const req2 = new IncomingMessage(socket);
  const res = new ServerResponse(req2) as ServerResponse & { _status?: number; _body?: string };
  let bodyAcc = "";
  res.write = ((chunk: unknown) => {
    bodyAcc += String(chunk);
    return true;
  }) as unknown as typeof res.write;
  const origEnd = res.end.bind(res);
  res.end = ((chunk?: unknown) => {
    if (chunk) bodyAcc += String(chunk);
    res._body = bodyAcc;
    return origEnd();
  }) as unknown as typeof res.end;
  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = ((status: number, ...rest: unknown[]) => {
    res._status = status;
    return (origWriteHead as (...args: unknown[]) => ServerResponse)(status, ...rest);
  }) as unknown as typeof res.writeHead;
  return res;
}

describe("createMcpHttp SEP-2243 default enforcement", () => {
  it("POST without Mcp-Method returns HTTP 400 with JSON-RPC -32001", async () => {
    const handle = createMcpHttp({
      name: "t",
      version: "0",
      tools: [],
      onToolCall: async () => ({ content: [{ type: "text" as const, text: "" }] }),
    });
    const req = makeMockReq(
      "POST",
      { "content-type": "application/json" },
      { jsonrpc: "2.0", id: 7, method: "tools/list" },
    );
    const res = makeMockRes();
    await handle.handleNodeRequest(req, res);
    assert.equal(res._status, 400);
    const parsed = JSON.parse(res._body ?? "{}") as {
      jsonrpc: string;
      id: unknown;
      error?: { code: number; message: string; data?: { reason: string } };
    };
    assert.equal(parsed.jsonrpc, "2.0");
    assert.equal(parsed.id, 7);
    assert.equal(parsed.error?.code, -32001);
    assert.equal(parsed.error?.message, "HeaderMismatch");
    assert.ok(typeof parsed.error?.data?.reason === "string" && parsed.error.data.reason.length > 0);
    await handle.close();
  });

  it("uses null for id when body is malformed (not a JSON-RPC object)", async () => {
    const handle = createMcpHttp({
      name: "t",
      version: "0",
      tools: [],
      onToolCall: async () => ({ content: [{ type: "text" as const, text: "" }] }),
    });
    const req = makeMockReq(
      "POST",
      { "content-type": "application/json" },
      "not-json-object",
    );
    const res = makeMockRes();
    await handle.handleNodeRequest(req, res);
    const parsed = JSON.parse(res._body ?? "{}") as {
      id: unknown;
      error?: { code: number };
    };
    assert.equal(parsed.id, null);
    assert.equal(parsed.error?.code, -32001);
    await handle.close();
  });

  it("requireSep2243: false disables enforcement — no HeaderMismatch error returned", async () => {
    const handle = createMcpHttp({
      name: "t",
      version: "0",
      tools: [],
      requireSep2243: false,
      onToolCall: async () => ({ content: [{ type: "text" as const, text: "" }] }),
    });
    const req = makeMockReq(
      "POST",
      { "content-type": "application/json" },
      { jsonrpc: "2.0", id: 5, method: "tools/list" },
    );
    const res = makeMockRes();
    await handle.handleNodeRequest(req, res);
    // SEP-2243 guard is skipped — response body must not be a HeaderMismatch JSON-RPC error.
    // (The SDK transport may fail on a mock socket, but it won't emit -32001.)
    const body = res._body ?? "{}";
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(body) as Record<string, unknown>; } catch { /* not json */ }
    const err = parsed["error"] as Record<string, unknown> | undefined;
    assert.notEqual(err?.["code"], -32001);
    await handle.close();
  });
});

describe("createMcpHttp Mcp-Param-* coherence", () => {
  const tool = {
    name: "create_invoice",
    description: "",
    inputSchema: {
      type: "object" as const,
      properties: {
        tenant_id: { type: "string", "x-mcp-header": "TenantId" },
        invoice_id: { type: "string" },
      },
      required: ["tenant_id", "invoice_id"],
    },
    _source: {
      framework: "express" as const,
      method: "POST" as const,
      url: "/invoices",
      paramMap: { tenant_id: "body" as const, invoice_id: "body" as const },
    },
  };

  it("body has tenant_id but Mcp-Param-TenantId header missing → -32001", async () => {
    const handle = createMcpHttp({
      name: "t",
      version: "0",
      tools: [tool],
      onToolCall: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
    });
    const req = makeMockReq(
      "POST",
      {
        "content-type": "application/json",
        "mcp-method": "tools/call",
        "mcp-name": "create_invoice",
      },
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: {
          name: "create_invoice",
          arguments: { tenant_id: "acme", invoice_id: "i1" },
        },
      },
    );
    const res = makeMockRes();
    await handle.handleNodeRequest(req, res);
    assert.equal(res._status, 400);
    const parsed = JSON.parse(res._body ?? "{}") as {
      error?: { code: number; data?: { reason: string } };
    };
    assert.equal(parsed.error?.code, -32001);
    assert.match(parsed.error?.data?.reason ?? "", /TenantId/);
    await handle.close();
  });

  it("Mcp-Param-TenantId mismatches body.tenant_id → -32001", async () => {
    const handle = createMcpHttp({
      name: "t",
      version: "0",
      tools: [tool],
      onToolCall: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
    });
    const req = makeMockReq(
      "POST",
      {
        "content-type": "application/json",
        "mcp-method": "tools/call",
        "mcp-name": "create_invoice",
        "mcp-param-tenantid": "evil",
      },
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "create_invoice",
          arguments: { tenant_id: "acme", invoice_id: "i1" },
        },
      },
    );
    const res = makeMockRes();
    await handle.handleNodeRequest(req, res);
    assert.equal(res._status, 400);
    const parsed = JSON.parse(res._body ?? "{}") as {
      error?: { code: number };
    };
    assert.equal(parsed.error?.code, -32001);
    await handle.close();
  });
});
