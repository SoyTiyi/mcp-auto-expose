import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { restoreStdoutGuard, isStdoutGuardInstalled } from "./stdoutGuard.js";
import { startStdio } from "./startStdio.js";
import type { MCPTool } from "@mcp-auto-expose/core";
import type { Server } from "@modelcontextprotocol/sdk/server";
import type { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const noop = async () => ({ content: [{ type: "text" as const, text: "noop" }] });

const sampleTools: MCPTool[] = [
  {
    name: "list_items",
    description: "List items",
    inputSchema: { type: "object", properties: {} },
    _source: { framework: "fastify", method: "GET", url: "/api/items", paramMap: {} },
  },
];

// Minimal stub that satisfies the Server/Transport shapes used inside startStdio
function makeServerStub(onClose?: () => void): Server {
  return {
    setRequestHandler: () => {},
    connect: async () => {},
    close: async () => { onClose?.(); },
  } as unknown as Server;
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
    assert.equal(isStdoutGuardInstalled(), true, "guard should be installed");
  });

  it("skips stdout guard when installGuard is false", async () => {
    const server = makeServerStub();
    const transport = makeTransportStub();
    await startStdio(
      { name: "test", version: "0.0.0", tools: sampleTools, installGuard: false, onToolCall: noop },
      { server, transport },
    );
    assert.equal(isStdoutGuardInstalled(), false, "guard should NOT be installed");
  });

  it("close() delegates to server.close()", async () => {
    let closeCalled = false;
    const server = makeServerStub(() => { closeCalled = true; });
    const transport = makeTransportStub();
    const handle = await startStdio(
      { name: "test", version: "0.0.0", tools: sampleTools, installGuard: false, onToolCall: noop },
      { server, transport },
    );
    await handle.close();
    assert.equal(closeCalled, true);
  });

  it("calls server.connect with the transport", async () => {
    let connectedTransport: unknown = null;
    const server = {
      setRequestHandler: () => {},
      connect: async (t: unknown) => { connectedTransport = t; },
      close: async () => {},
    } as unknown as Server;
    const transport = makeTransportStub();
    await startStdio(
      { name: "test", version: "0.0.0", tools: sampleTools, installGuard: false, onToolCall: noop },
      { server, transport },
    );
    assert.equal(connectedTransport, transport, "server.connect must receive the transport");
  });

  it("throws when neither onToolCall nor apiBaseUrl provided", async () => {
    const server = makeServerStub();
    const transport = makeTransportStub();
    await assert.rejects(
      () =>
        startStdio(
          { name: "test", version: "0.0.0", tools: sampleTools, installGuard: false },
          { server, transport },
        ),
      /apiBaseUrl.*onToolCall|onToolCall.*apiBaseUrl/i,
    );
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
    
    assert.equal(calls.length, 0);
  });
});
