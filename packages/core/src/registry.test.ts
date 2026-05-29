import { test, expect } from "vitest";
import type { MCPTool } from "./types.js";
import { INTERNAL_SOURCE } from "./internal.js";
import { ToolRegistry } from "./registry.js";

function makeTool(name: string): MCPTool {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: { type: "object", properties: {} },
    [INTERNAL_SOURCE]: { framework: "fastify", method: "GET", url: `/${name}`, paramMap: {} },
  };
}

test("register and list single tool", () => {
  const registry = new ToolRegistry();
  const tool = makeTool("test_tool");
  registry.register(tool);
  const list = registry.list();
  expect(list.length).toBe(1);
  expect(list[0]?.name).toBe("test_tool");
});

test("list is sorted alphabetically", () => {
  const registry = new ToolRegistry();
  registry.register(makeTool("z_tool"));
  registry.register(makeTool("a_tool"));
  registry.register(makeTool("m_tool"));
  const list = registry.list();
  expect(list.length).toBe(3);
  expect(list[0]?.name).toBe("a_tool");
  expect(list[1]?.name).toBe("m_tool");
  expect(list[2]?.name).toBe("z_tool");
});

test("no collision with different names", () => {
  const registry = new ToolRegistry();
  registry.register(makeTool("tool_one"));
  registry.register(makeTool("tool_two"));
  const list = registry.list();
  expect(list.length).toBe(2);
  expect(list[0]?.name).toBe("tool_one");
  expect(list[1]?.name).toBe("tool_two");
});

test("collision with same name renames to name_2", () => {
  const registry = new ToolRegistry();
  registry.register(makeTool("same_name"));
  registry.register(makeTool("same_name"));
  const list = registry.list();
  expect(list.length).toBe(2);
  expect(list.map((t) => t.name).sort()).toEqual(["same_name", "same_name_2"]);
});

test("collision with name_2 also taken renames to name_3", () => {
  const registry = new ToolRegistry();
  registry.register(makeTool("tool"));
  registry.register(makeTool("tool"));
  registry.register(makeTool("tool"));
  const list = registry.list();
  expect(list.length).toBe(3);
  expect(list.map((t) => t.name).sort()).toEqual(["tool", "tool_2", "tool_3"]);
});

test("collision logs to stderr", () => {
  const registry = new ToolRegistry();
  let stderrOutput = "";
  const origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (msg: string | Uint8Array) => {
    stderrOutput += msg.toString();
    return true;
  };
  try {
    registry.register(makeTool("collision_tool"));
    registry.register(makeTool("collision_tool"));
    expect(stderrOutput.includes("collision_tool")).toBeTruthy();
    expect(stderrOutput.includes("collision_tool_2")).toBeTruthy();
    expect(stderrOutput.includes("renamed to")).toBeTruthy();
  } finally {
    process.stderr.write = origWrite;
  }
});

test("clear empties the registry", () => {
  const registry = new ToolRegistry();
  registry.register(makeTool("tool_one"));
  registry.register(makeTool("tool_two"));
  expect(registry.list().length).toBe(2);
  registry.clear();
  expect(registry.list().length).toBe(0);
});
