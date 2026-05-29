import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as http from "node:http";
import { makeHttpCaller } from "./httpCaller.js";
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

interface TestRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function startTestServer(handler: (req: TestRequest) => { status: number; body: string }): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  lastRequest: () => TestRequest | undefined;
}> {
  let lastReq: TestRequest | undefined;

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let rawBody = "";
      req.on("data", (chunk: Buffer) => {
        rawBody += chunk.toString();
      });
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

  beforeAll(async () => {
    ({
      baseUrl,
      close: closeServer,
      lastRequest,
    } = await startTestServer((req) => {
      if (req.url === "/error") return { status: 500, body: JSON.stringify({ error: "internal" }) };
      if (req.url === "/users") return { status: 200, body: JSON.stringify([{ id: "u1" }]) };
      if (req.url?.startsWith("/users/"))
        return { status: 200, body: JSON.stringify({ id: req.url.split("/").pop() }) };
      return { status: 200, body: JSON.stringify({ ok: true }) };
    }));
  });

  afterAll(async () => {
    await closeServer();
  });

  it("1. GET with URL params → correct URL, returns backend data", async () => {
    const caller = makeHttpCaller({ baseUrl });
    const tool = makeTool({
      source: {
        framework: "express",
        method: "GET",
        url: "/users/:id",
        paramMap: { id: "params" },
      },
    });
    const result = await caller(tool, { id: "u1" });
    expect(result.isError).toBe(undefined);
    const req = lastRequest()!;
    expect(req.method).toBe("GET");
    expect(req.url).toBe("/users/u1");
    expect(result.content[0]?.text.includes("u1"), "response contains id").toBeTruthy();
  });

  it("2. POST with body → JSON sent correctly", async () => {
    const caller = makeHttpCaller({ baseUrl });
    const tool = makeTool({
      source: {
        framework: "express",
        method: "POST",
        url: "/users",
        paramMap: { name: "body", email: "body" },
      },
    });
    await caller(tool, { name: "Ana", email: "ana@test.com" });
    const req = lastRequest()!;
    expect(req.method).toBe("POST");
    expect(req.headers["content-type"]).toBe("application/json");
    const parsed = JSON.parse(req.body) as { name: string; email: string };
    expect(parsed.name).toBe("Ana");
    expect(parsed.email).toBe("ana@test.com");
  });

  it("3. Backend returns non-OK → isError: true", async () => {
    const caller = makeHttpCaller({ baseUrl });
    const tool = makeTool({
      source: {
        framework: "express",
        method: "GET",
        url: "/error",
        paramMap: {},
      },
    });
    const result = await caller(tool, {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text.includes("internal"), "error text in response").toBeTruthy();
  });

  it("4. Timeout → isError: true", async () => {
    const hangServer = http.createServer(() => {
      /* intentionally never responds */
    });
    const hangBaseUrl = await new Promise<string>((resolve) => {
      hangServer.listen(0, "127.0.0.1", () => {
        const addr = hangServer.address() as { port: number };
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    });
    try {
      const caller = makeHttpCaller({ baseUrl: hangBaseUrl, timeoutMs: 50 });
      const tool = makeTool({
        source: { framework: "express", method: "GET", url: "/users", paramMap: {} },
      });
      const result = await caller(tool, {});
      expect(result.isError).toBe(true);
      expect((result.content[0]?.text ?? "").length > 0, "error text present").toBeTruthy();
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
    await caller(tool, { id: "u1", tenant_id: "acme" });
    const req = lastRequest()!;
    expect(req.headers["mcp-param-tenantid"]).toBe("acme");
    expect(req.url).toBe("/users/u1");
  });

  it("6. defaultHeaders forwarded to every request", async () => {
    const caller = makeHttpCaller({
      baseUrl,
      defaultHeaders: { Authorization: "Bearer token123" },
    });
    const tool = makeTool({
      source: { framework: "express", method: "GET", url: "/users", paramMap: {} },
    });
    await caller(tool, {});
    const req = lastRequest()!;
    expect(req.headers["authorization"]).toBe("Bearer token123");
  });

  it("7. SEP-414: traceparent/tracestate/baggage forwarded to backend when ctx.traceContext set", async () => {
    const caller = makeHttpCaller({ baseUrl });
    const tool = makeTool({
      source: { framework: "express", method: "GET", url: "/users", paramMap: {} },
    });
    const ctx = {
      traceContext: {
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        tracestate: "rojo=00f067aa0ba902b7",
        baggage: "userId=alice",
      },
    };
    await caller(tool, {}, ctx);
    const req = lastRequest()!;
    expect(req.headers["traceparent"]).toBe(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    );
    expect(req.headers["tracestate"]).toBe("rojo=00f067aa0ba902b7");
    expect(req.headers["baggage"]).toBe("userId=alice");
  });

  it("8. SEP-414: no trace headers forwarded when ctx has no traceContext", async () => {
    const caller = makeHttpCaller({ baseUrl });
    const tool = makeTool({
      source: { framework: "express", method: "GET", url: "/users", paramMap: {} },
    });
    await caller(tool, {}, {});
    const req = lastRequest()!;
    expect(req.headers["traceparent"]).toBe(undefined);
    expect(req.headers["tracestate"]).toBe(undefined);
  });

  it("9. SEP-414: only present trace headers are forwarded (partial set)", async () => {
    const caller = makeHttpCaller({ baseUrl });
    const tool = makeTool({
      source: { framework: "express", method: "GET", url: "/users", paramMap: {} },
    });
    const ctx = { traceContext: { traceparent: "00-abc-def-01" } };
    await caller(tool, {}, ctx);
    const req = lastRequest()!;
    expect(req.headers["traceparent"]).toBe("00-abc-def-01");
    expect(req.headers["tracestate"]).toBe(undefined);
    expect(req.headers["baggage"]).toBe(undefined);
  });
});
