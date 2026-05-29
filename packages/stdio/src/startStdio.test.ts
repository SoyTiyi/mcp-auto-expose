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
    await expect(() =>
      startStdio(
        { name: "test", version: "0.0.0", tools: sampleTools, installGuard: false },
        { server, transport },
      ),
    ).not.toThrow();
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
