import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { MCPTool } from "./types.js";
import { ToolRegistry } from "./registry.js";

function makeTool(name: string): MCPTool {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: { type: "object", properties: {} },
    _source: { framework: "fastify", method: "GET", url: `/${name}` },
  };
}

test("register and list single tool", () => {
  const registry = new ToolRegistry();
  const tool = makeTool("test_tool");
  registry.register(tool);
  const list = registry.list();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.name, "test_tool");
});

test("list is sorted alphabetically", () => {
  const registry = new ToolRegistry();
  registry.register(makeTool("z_tool"));
  registry.register(makeTool("a_tool"));
  registry.register(makeTool("m_tool"));
  const list = registry.list();
  assert.equal(list.length, 3);
  assert.equal(list[0]?.name, "a_tool");
  assert.equal(list[1]?.name, "m_tool");
  assert.equal(list[2]?.name, "z_tool");
});

test("no collision with different names", () => {
  const registry = new ToolRegistry();
  registry.register(makeTool("tool_one"));
  registry.register(makeTool("tool_two"));
  const list = registry.list();
  assert.equal(list.length, 2);
  assert.equal(list[0]?.name, "tool_one");
  assert.equal(list[1]?.name, "tool_two");
});

test("collision with same name renames to name_2", () => {
  const registry = new ToolRegistry();
  registry.register(makeTool("same_name"));
  registry.register(makeTool("same_name"));
  const list = registry.list();
  assert.equal(list.length, 2);
  assert.deepEqual(
    list.map((t) => t.name).sort(),
    ["same_name", "same_name_2"]
  );
});

test("collision with name_2 also taken renames to name_3", () => {
  const registry = new ToolRegistry();
  registry.register(makeTool("tool"));
  registry.register(makeTool("tool"));
  registry.register(makeTool("tool"));
  const list = registry.list();
  assert.equal(list.length, 3);
  assert.deepEqual(
    list.map((t) => t.name).sort(),
    ["tool", "tool_2", "tool_3"]
  );
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
    assert.ok(stderrOutput.includes("collision_tool"));
    assert.ok(stderrOutput.includes("collision_tool_2"));
    assert.ok(stderrOutput.includes("renamed to"));
  } finally {
    process.stderr.write = origWrite;
  }
});

test("clear empties the registry", () => {
  const registry = new ToolRegistry();
  registry.register(makeTool("tool_one"));
  registry.register(makeTool("tool_two"));
  assert.equal(registry.list().length, 2);
  registry.clear();
  assert.equal(registry.list().length, 0);
});
