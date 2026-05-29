import { test, describe, expect } from "vitest";
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
    expect(tool.name).toBe("echo");
    expect(tool.description).toBe("Echoes input");
    expect(tool.inputSchema.type).toBe("object");
    expect("message" in tool.inputSchema.properties).toBeTruthy();
  });

  test("INTERNAL_SOURCE has framework=manual and an execute function", () => {
    const tool = defineTool({
      name: "ping",
      description: "Ping",
      inputSchema: z.object({}),
      execute: async () => ({ content: [{ type: "text", text: "pong" }] }),
    });
    const src = tool[INTERNAL_SOURCE];
    expect(src.framework).toBe("manual");
    expect(src.url).toBe("");
    expect(src.method).toBe("GET");
    expect(typeof src.execute).toBe("function");
  });

  test("execute callback runs with correct args", async () => {
    const tool = defineTool({
      name: "greet",
      description: "Greet",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => ({ content: [{ type: "text", text: `Hello ${name}` }] }),
    });
    const result = await tool[INTERNAL_SOURCE].execute!({ name: "World" });
    expect(result).toEqual({ content: [{ type: "text", text: "Hello World" }] });
  });

  test("empty inputSchema z.object({}) produces valid MCPToolInputSchema", () => {
    const tool = defineTool({
      name: "ping",
      description: "Ping",
      inputSchema: z.object({}),
      execute: async () => ({ content: [{ type: "text", text: "pong" }] }),
    });
    expect(tool.inputSchema.type).toBe("object");
    expect(tool.inputSchema.properties).toEqual({});
  });

  test("does not throw when creating tool with optional fields", () => {
    expect(() => {
      defineTool({
        name: "complex",
        description: "Complex schema",
        inputSchema: z.object({
          name: z.string(),
          age: z.number().optional(),
          tags: z.array(z.string()).optional(),
        }),
        execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
      });
    }).not.toThrow();
  });

  test("execute function is callable and returns ToolCallResult", async () => {
    const tool = defineTool({
      name: "adder",
      description: "Adds numbers",
      inputSchema: z.object({ a: z.number(), b: z.number() }),
      execute: async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
    });

    // Simulate how startStdio/createMcpHttp calls the execute function
    const src = tool[INTERNAL_SOURCE];
    expect(typeof src.execute).toBe("function");
    const result = await src.execute!({ a: 3, b: 4 });
    expect(result).toEqual({ content: [{ type: "text", text: "7" }] });
  });
});
