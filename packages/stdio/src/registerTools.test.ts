import { describe, it, expect } from "vitest";
import type { MCPTool } from "@mcp-auto-expose/core";
import { INTERNAL_SOURCE } from "@mcp-auto-expose/core/internal";
import { registerTools } from "./registerTools.js";

// Minimal stub that records setRequestHandler calls.
// Shaped as { server: { setRequestHandler, handlers } } to match McpServer's escape hatch.
function makeServerStub() {
  const handlers: { schema: unknown; handler: (...a: unknown[]) => unknown }[] = [];
  return {
    server: {
      setRequestHandler(schema: unknown, handler: (...a: unknown[]) => unknown) {
        handlers.push({ schema, handler });
      },
      handlers,
    },
  };
}

const noop = async () => ({ content: [{ type: "text" as const, text: "noop" }] });

const sampleTools: MCPTool[] = [
  {
    name: "list_users",
    description: "List all users",
    inputSchema: { type: "object", properties: {} },
    [INTERNAL_SOURCE]: { framework: "fastify", method: "GET", url: "/api/users", paramMap: {} },
  },
  {
    name: "create_users",
    description: "Create a user",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" }, email: { type: "string" } },
      required: ["name", "email"],
    },
    [INTERNAL_SOURCE]: {
      framework: "fastify",
      method: "POST",
      url: "/api/users",
      paramMap: { name: "body", email: "body" },
    },
  },
];

describe("registerTools", () => {
  it("registers exactly 2 request handlers (list + call) regardless of tool count", () => {
    const server = makeServerStub();
    registerTools({ server: server as never, tools: sampleTools, onToolCall: noop });
    expect(server.server.handlers.length).toBe(2);
  });

  it("tools/list handler returns all tools with correct name and description", async () => {
    const server = makeServerStub();
    registerTools({ server: server as never, tools: sampleTools, onToolCall: noop });
    const listHandler = server.server.handlers[0]?.handler;
    expect(listHandler, "ListTools handler must be registered").toBeTruthy();
    const result = await listHandler!({});
    expect(typeof result === "object" && result !== null).toBeTruthy();
    const r = result as { tools: { name: string; description: string; inputSchema: unknown }[] };
    expect(r.tools.length).toBe(2);
    expect(r.tools[0]?.name).toBe("list_users");
    expect(r.tools[0]?.description).toBe("List all users");
    expect(r.tools[1]?.name).toBe("create_users");
  });

  it("tools/list handler returns correct inputSchema for each tool", async () => {
    const server = makeServerStub();
    registerTools({ server: server as never, tools: sampleTools, onToolCall: noop });
    const listHandler = server.server.handlers[0]?.handler;
    expect(listHandler).toBeTruthy();
    const result = (await listHandler!({})) as {
      tools: { inputSchema: Record<string, unknown> }[];
    };
    const schema = result.tools[1]?.inputSchema;
    expect(schema, "inputSchema must be present").toBeTruthy();
    expect((schema as Record<string, unknown>)["required"]).toEqual(["name", "email"]);
  });

  it("tools/call handler invokes onToolCall and returns its result", async () => {
    const server = makeServerStub();
    const customResult = { content: [{ type: "text" as const, text: "invoked!" }] };
    registerTools({
      server: server as never,
      tools: sampleTools,
      onToolCall: async () => customResult,
    });
    const callHandler = server.server.handlers[1]?.handler;
    expect(callHandler).toBeTruthy();
    const result = await callHandler!({ params: { name: "list_users", arguments: {} } });
    expect(result).toEqual(customResult);
  });

  it("tools/call handler returns error content for unknown tool", async () => {
    const server = makeServerStub();
    registerTools({ server: server as never, tools: sampleTools, onToolCall: noop });
    const callHandler = server.server.handlers[1]?.handler;
    expect(callHandler).toBeTruthy();
    const result = (await callHandler!({ params: { name: "nonexistent_tool", arguments: {} } })) as {
      content: { type: string; text: string }[];
      isError: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text.includes("nonexistent_tool")).toBeTruthy();
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
    const callHandler = server.server.handlers[1]?.handler;
    expect(callHandler).toBeTruthy();
    await callHandler!({ params: { name: "create_users", arguments: { name: "Ana" } } });
    expect(received, "onToolCall must have been called").toBeTruthy();
    expect(received!.tool.name).toBe("create_users");
    expect(received!.args).toEqual({ name: "Ana" });
  });

  it("registers handlers with empty tools list without throwing", () => {
    const server = makeServerStub();
    expect(() =>
      registerTools({ server: server as never, tools: [], onToolCall: noop }),
    ).not.toThrow();
    expect(server.server.handlers.length).toBe(2);
  });
});
