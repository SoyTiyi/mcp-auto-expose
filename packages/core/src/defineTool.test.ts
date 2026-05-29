import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { defineTool } from "./defineTool.js";
import { INTERNAL_SOURCE } from "./internal.js";

describe("defineTool", () => {
  test("creates a tool with the correct name, description, inputSchema", () => {
    const tool = defineTool({
      name: "echo",
      description: "Echoes input",
      inputSchema: z.object({ message: z.string() }),
      execute: async ({ message }) => ({ content: [{ type: "text", text: message }] }),
    });
    assert.equal(tool.name, "echo");
    assert.equal(tool.description, "Echoes input");
    assert.equal(tool.inputSchema.type, "object");
    assert.ok("message" in tool.inputSchema.properties);
  });

  test("INTERNAL_SOURCE has framework=manual and an execute function", () => {
    const tool = defineTool({
      name: "ping",
      description: "Ping",
      inputSchema: z.object({}),
      execute: async () => ({ content: [{ type: "text", text: "pong" }] }),
    });
    const src = tool[INTERNAL_SOURCE];
    assert.equal(src.framework, "manual");
    assert.equal(src.url, "");
    assert.equal(src.method, "GET");
    assert.equal(typeof src.execute, "function");
  });

  test("execute callback runs with correct args", async () => {
    const tool = defineTool({
      name: "greet",
      description: "Greet",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => ({ content: [{ type: "text", text: `Hello ${name}` }] }),
    });
    const result = await tool[INTERNAL_SOURCE].execute!({ name: "World" });
    assert.deepEqual(result, { content: [{ type: "text", text: "Hello World" }] });
  });

  test("empty inputSchema z.object({}) produces valid MCPToolInputSchema", () => {
    const tool = defineTool({
      name: "ping",
      description: "Ping",
      inputSchema: z.object({}),
      execute: async () => ({ content: [{ type: "text", text: "pong" }] }),
    });
    assert.equal(tool.inputSchema.type, "object");
    assert.deepEqual(tool.inputSchema.properties, {});
  });
});
