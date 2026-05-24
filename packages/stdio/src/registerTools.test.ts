import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { MCPTool } from "@mcp-auto-expose/core";
import { registerTools } from "./registerTools.js";

// Minimal stub that records setRequestHandler calls
function makeServerStub() {
  const handlers: { schema: unknown; handler: (...a: unknown[]) => unknown }[] = [];
  return {
    setRequestHandler(schema: unknown, handler: (...a: unknown[]) => unknown) {
      handlers.push({ schema, handler });
    },
    handlers,
  };
}

const noop = async () => ({ content: [{ type: "text" as const, text: "noop" }] });

const sampleTools: MCPTool[] = [
  {
    name: "list_users",
    description: "List all users",
    inputSchema: { type: "object", properties: {} },
    _source: { framework: "fastify", method: "GET", url: "/api/users", paramMap: {} },
  },
  {
    name: "create_users",
    description: "Create a user",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, email: { type: "string" } },
      required: ["name", "email"],
    },
    _source: { framework: "fastify", method: "POST", url: "/api/users", paramMap: { name: "body", email: "body" } },
  },
];

describe("registerTools", () => {
  it("registers exactly 2 request handlers (list + call) regardless of tool count", () => {
    const server = makeServerStub();
    registerTools({ server: server as never, tools: sampleTools, onToolCall: noop });
    assert.equal(server.handlers.length, 2, "must register ListTools and CallTool handlers");
  });

  it("tools/list handler returns all tools with correct name and description", async () => {
    const server = makeServerStub();
    registerTools({ server: server as never, tools: sampleTools, onToolCall: noop });
    const listHandler = server.handlers[0]?.handler;
    assert.ok(listHandler, "ListTools handler must be registered");
    const result = await listHandler({});
    assert.ok(typeof result === "object" && result !== null);
    const r = result as { tools: { name: string; description: string; inputSchema: unknown }[] };
    assert.equal(r.tools.length, 2);
    assert.equal(r.tools[0]?.name, "list_users");
    assert.equal(r.tools[0]?.description, "List all users");
    assert.equal(r.tools[1]?.name, "create_users");
  });

  it("tools/list handler returns correct inputSchema for each tool", async () => {
    const server = makeServerStub();
    registerTools({ server: server as never, tools: sampleTools, onToolCall: noop });
    const listHandler = server.handlers[0]?.handler;
    assert.ok(listHandler);
    const result = await listHandler({}) as {
      tools: { inputSchema: Record<string, unknown> }[];
    };
    const schema = result.tools[1]?.inputSchema;
    assert.ok(schema, "inputSchema must be present");
    assert.deepEqual(
      (schema as Record<string, unknown>)["required"],
      ["name", "email"],
    );
  });

  it("tools/call handler invokes onToolCall and returns its result", async () => {
    const server = makeServerStub();
    const customResult = { content: [{ type: "text" as const, text: "invoked!" }] };
    registerTools({
      server: server as never,
      tools: sampleTools,
      onToolCall: async () => customResult,
    });
    const callHandler = server.handlers[1]?.handler;
    assert.ok(callHandler);
    const result = await callHandler({ params: { name: "list_users", arguments: {} } });
    assert.deepEqual(result, customResult);
  });

  it("tools/call handler returns error content for unknown tool", async () => {
    const server = makeServerStub();
    registerTools({ server: server as never, tools: sampleTools, onToolCall: noop });
    const callHandler = server.handlers[1]?.handler;
    assert.ok(callHandler);
    const result = await callHandler({ params: { name: "nonexistent_tool", arguments: {} } }) as {
      content: { type: string; text: string }[];
      isError: boolean;
    };
    assert.equal(result.isError, true);
    assert.ok(result.content[0]?.text.includes("nonexistent_tool"));
  });

  it("onToolCall receives the tool object and args", async () => {
    const server = makeServerStub();
    let received: { tool: MCPTool; args: unknown } | undefined;
    registerTools({
      server: server as never,
      tools: sampleTools,
      onToolCall: async (tool, args) => {
        received = { tool, args };
        return { content: [{ type: "text" as const, text: "ok" }] };
      },
    });
    const callHandler = server.handlers[1]?.handler;
    assert.ok(callHandler);
    await callHandler({ params: { name: "create_users", arguments: { name: "Ana" } } });
    assert.ok(received, "onToolCall must have been called");
    assert.equal(received.tool.name, "create_users");
    assert.deepEqual(received.args, { name: "Ana" });
  });

  it("registers handlers with empty tools list without throwing", () => {
    const server = makeServerStub();
    assert.doesNotThrow(() => registerTools({ server: server as never, tools: [], onToolCall: noop }));
    assert.equal(server.handlers.length, 2);
  });
});
