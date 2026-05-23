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

const sampleTools: MCPTool[] = [
  {
    name: "list_users",
    description: "List all users",
    inputSchema: { type: "object", properties: {} },
    _source: { framework: "fastify", method: "GET", url: "/api/users" },
  },
  {
    name: "create_users",
    description: "Create a user",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, email: { type: "string" } },
      required: ["name", "email"],
    },
    _source: { framework: "fastify", method: "POST", url: "/api/users" },
  },
];

describe("registerTools", () => {
  it("registers exactly 2 request handlers (list + call) regardless of tool count", () => {
    const server = makeServerStub();
    registerTools({ server: server as never, tools: sampleTools });
    assert.equal(server.handlers.length, 2, "must register ListTools and CallTool handlers");
  });

  it("tools/list handler returns all tools with correct name and description", async () => {
    const server = makeServerStub();
    registerTools({ server: server as never, tools: sampleTools });
    // First handler is ListTools
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
    registerTools({ server: server as never, tools: sampleTools });
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

  it("tools/call handler returns placeholder content with method and url in text", async () => {
    const server = makeServerStub();
    registerTools({ server: server as never, tools: sampleTools });
    // Second handler is CallTool
    const callHandler = server.handlers[1]?.handler;
    assert.ok(callHandler);
    const result = await callHandler({ params: { name: "list_users", arguments: {} } }) as {
      content: { type: string; text: string }[];
    };
    assert.ok(Array.isArray(result.content));
    const text = result.content[0]?.text ?? "";
    assert.ok(text.includes("list_users"), "placeholder must mention tool name");
    assert.ok(text.includes("GET"), "placeholder must mention source method");
    assert.ok(text.includes("/api/users"), "placeholder must mention source url");
  });

  it("tools/call handler returns error content for unknown tool", async () => {
    const server = makeServerStub();
    registerTools({ server: server as never, tools: sampleTools });
    const callHandler = server.handlers[1]?.handler;
    assert.ok(callHandler);
    const result = await callHandler({ params: { name: "nonexistent_tool", arguments: {} } }) as {
      content: { type: string; text: string }[];
      isError: boolean;
    };
    assert.equal(result.isError, true);
    assert.ok(result.content[0]?.text.includes("nonexistent_tool"));
  });

  it("tools/call uses custom onToolCall when provided", async () => {
    const server = makeServerStub();
    const customResult = { content: [{ type: "text" as const, text: "custom!" }] };
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

  it("registers handlers with empty tools list without throwing", () => {
    const server = makeServerStub();
    assert.doesNotThrow(() => registerTools({ server: server as never, tools: [] }));
    assert.equal(server.handlers.length, 2);
  });
});
