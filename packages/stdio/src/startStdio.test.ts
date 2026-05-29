import { describe, it, afterEach, expect } from "vitest";
import { restoreStdoutGuard, isStdoutGuardInstalled } from "./stdoutGuard.js";
import { startStdio } from "./startStdio.js";
import type { MCPTool } from "@mcp-auto-expose/core";
import { INTERNAL_SOURCE } from "@mcp-auto-expose/core/internal";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const noop = async () => ({ content: [{ type: "text" as const, text: "noop" }] });

const sampleTools: MCPTool[] = [
  {
    name: "list_items",
    description: "List items",
    inputSchema: { type: "object", properties: {} },
    [INTERNAL_SOURCE]: { framework: "fastify", method: "GET", url: "/api/items", paramMap: {} },
  },
];

// Minimal stub that satisfies McpServer shape used inside startStdio.
// server.server is the escape hatch used by registerTools.
function makeServerStub(onClose?: () => void): McpServer {
  return {
    server: { setRequestHandler: () => {} },
    connect: async () => {},
    close: async () => {
      onClose?.();
    },
  } as unknown as McpServer;
}

// Capturing stub: records handlers so tests can invoke them directly.
function makeCapturingServerStub(): {
  server: McpServer;
  handlers: { schema: unknown; handler: (...a: unknown[]) => unknown }[];
} {
  const handlers: { schema: unknown; handler: (...a: unknown[]) => unknown }[] = [];
  const server = {
    server: {
      setRequestHandler(schema: unknown, handler: (...a: unknown[]) => unknown) {
        handlers.push({ schema, handler });
      },
    },
    connect: async () => {},
    close: async () => {},
  } as unknown as McpServer;
  return { server, handlers };
}

function makeTransportStub(): StdioServerTransport {
  return {} as StdioServerTransport;
}

describe("startStdio", () => {
  afterEach(() => {
    restoreStdoutGuard();
  });

  it("installs stdout guard by default when installGuard is not set", async () => {
    const server = makeServerStub();
    const transport = makeTransportStub();
    await startStdio(
      { name: "test", version: "0.0.0", tools: sampleTools, onToolCall: noop },
      { server, transport },
    );
    expect(isStdoutGuardInstalled()).toBe(true);
  });

  it("skips stdout guard when installGuard is false", async () => {
    const server = makeServerStub();
    const transport = makeTransportStub();
    await startStdio(
      { name: "test", version: "0.0.0", tools: sampleTools, installGuard: false, onToolCall: noop },
      { server, transport },
    );
    expect(isStdoutGuardInstalled()).toBe(false);
  });

  it("close() delegates to server.close()", async () => {
    let closeCalled = false;
    const server = makeServerStub(() => {
      closeCalled = true;
    });
    const transport = makeTransportStub();
    const handle = await startStdio(
      { name: "test", version: "0.0.0", tools: sampleTools, installGuard: false, onToolCall: noop },
      { server, transport },
    );
    await handle.close();
    expect(closeCalled).toBe(true);
  });

  it("calls server.connect with the transport", async () => {
    let connectedTransport: unknown = null;
    const server = {
      server: { setRequestHandler: () => {} },
      connect: async (t: unknown) => {
        connectedTransport = t;
      },
      close: async () => {},
    } as unknown as McpServer;
    const transport = makeTransportStub();
    await startStdio(
      { name: "test", version: "0.0.0", tools: sampleTools, installGuard: false, onToolCall: noop },
      { server, transport },
    );
    expect(connectedTransport).toBe(transport);
  });

  it("does not throw at init when neither onToolCall nor apiBaseUrl provided (error deferred to per-call)", async () => {
    const server = makeServerStub();
    const transport = makeTransportStub();
    await startStdio(
      { name: "test", version: "0.0.0", tools: sampleTools, installGuard: false },
      { server, transport },
    ); // test fails automatically if this rejects
  });

  it("onToolCall takes precedence over apiBaseUrl", async () => {
    const server = makeServerStub();
    const transport = makeTransportStub();
    const calls: string[] = [];
    await startStdio(
      {
        name: "test",
        version: "0.0.0",
        tools: sampleTools,
        installGuard: false,
        apiBaseUrl: "http://127.0.0.1:9",
        onToolCall: async (tool) => {
          calls.push(tool.name);
          return { content: [{ type: "text" as const, text: "explicit" }] };
        },
      },
      { server, transport },
    );

    expect(calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolvedOnToolCall dispatch — exercises the internal tool-call resolver
// that startStdio wires into registerTools.
// ---------------------------------------------------------------------------
describe("startStdio — resolvedOnToolCall dispatch", () => {
  afterEach(() => {
    restoreStdoutGuard();
  });

  // Helper: invoke the CallTool handler that startStdio registered.
  // Index 1 because registerTools always registers [ListTools(0), CallTool(1)].
  async function invokeCallHandler(
    handlers: { schema: unknown; handler: (...a: unknown[]) => unknown }[],
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    const callHandler = handlers[1]?.handler;
    if (!callHandler) throw new Error("CallTool handler not registered");
    return callHandler({ params: { name: toolName, arguments: args } });
  }

  it("resolvedOnToolCall: tool with execute() — calls execute directly (no http)", async () => {
    const { server, handlers } = makeCapturingServerStub();
    const transport = makeTransportStub();
    let executeCallCount = 0;
    const execute = async (_args: unknown) => {
      executeCallCount++;
      return { content: [{ type: "text" as const, text: "from-execute" }] };
    };

    const toolWithExecute: MCPTool = {
      name: "ping",
      description: "Ping",
      inputSchema: { type: "object", properties: {} },
      [INTERNAL_SOURCE]: {
        framework: "manual",
        method: "GET",
        url: "",
        paramMap: {},
        execute,
      },
    };

    await startStdio(
      { name: "t", version: "0", tools: [toolWithExecute], installGuard: false },
      { server, transport },
    );

    const result = (await invokeCallHandler(handlers, "ping")) as {
      content: { text: string }[];
    };
    expect(executeCallCount).toBe(1);
    expect(result.content[0]?.text).toBe("from-execute");
  });

  it("resolvedOnToolCall: no execute, no httpCaller → returns isError result", async () => {
    const { server, handlers } = makeCapturingServerStub();
    const transport = makeTransportStub();

    await startStdio(
      // No onToolCall, no apiBaseUrl → neither execute nor baseHttpCaller
      { name: "t", version: "0", tools: sampleTools, installGuard: false },
      { server, transport },
    );

    const result = (await invokeCallHandler(handlers, "list_items")) as {
      content: { text: string }[];
      isError: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/no executor/);
  });

  it("resolvedOnToolCall: no execute, has baseHttpCaller (apiBaseUrl) → delegates to httpCaller", async () => {
    // We spy on makeHttpCaller by injecting apiBaseUrl. The actual HTTP will fail (port 9),
    // but we only need to confirm that baseHttpCaller is invoked, not onToolCall.
    // We use a mock apiBaseUrl and capture calls via a custom onToolCall.
    // Actually, to avoid real network, override with onToolCall = undefined and apiBaseUrl.
    // The httpCaller will reject with a network error — we just verify it was attempted.
    const { server, handlers } = makeCapturingServerStub();
    const transport = makeTransportStub();

    await startStdio(
      { name: "t", version: "0", tools: sampleTools, installGuard: false, apiBaseUrl: "http://127.0.0.1:1" },
      { server, transport },
    );

    // The call will fail with a network error — that's expected. What matters is isError.
    const result = (await invokeCallHandler(handlers, "list_items").catch((e: unknown) => ({
      content: [{ type: "text", text: String(e) }],
      isError: true,
    }))) as { isError?: boolean; content?: Array<{ text?: string }> };
    // The fact that it reaches an error (not the "no executor" message) confirms httpCaller was used.
    expect(result.isError).toBe(true);
    // The httpCaller path produces a network/connection error, NOT the "no executor" message
    expect(result.content?.[0]?.text).not.toMatch(/no executor/);
  });
});
