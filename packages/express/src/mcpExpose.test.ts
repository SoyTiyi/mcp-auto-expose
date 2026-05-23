import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod/v3";
import { mcpExpose, MCP_EXPOSE_SYMBOL } from "./mcpExpose.js";
import type { RouteSchema } from "@mcp-auto-expose/core";

type WithSymbol = { [MCP_EXPOSE_SYMBOL]: RouteSchema };

function getSchema(fn: ReturnType<typeof mcpExpose>): RouteSchema {
  return (fn as unknown as WithSymbol)[MCP_EXPOSE_SYMBOL];
}

describe("mcpExpose — return value", () => {
  it("mcpExpose({}) returns a function", () => {
    const result = mcpExpose({});
    assert.equal(typeof result, "function");
  });
});

describe("mcpExpose — middleware behaviour", () => {
  it("calling the middleware invokes next() exactly once", () => {
    const fn = mcpExpose({});
    const req = {} as Parameters<typeof fn>[0];
    const res = {} as Parameters<typeof fn>[1];
    let callCount = 0;
    const next = () => {
      callCount++;
    };
    fn(req, res, next);
    assert.equal(callCount, 1);
  });
});

describe("mcpExpose — MCP_EXPOSE_SYMBOL metadata", () => {
  it("middleware has a non-null object attached at MCP_EXPOSE_SYMBOL", () => {
    const fn = mcpExpose({});
    const schema = getSchema(fn);
    assert.ok(schema !== null && typeof schema === "object");
  });

  it("mcpExpose({ query: z.string() }) → .querystring defined, .body undefined", () => {
    const fn = mcpExpose({ query: z.string() });
    const schema = getSchema(fn);
    assert.ok(schema.querystring !== undefined, "querystring should be defined");
    assert.equal(schema.body, undefined);
  });

  it("mcpExpose({ hide: true }) → schema.hide === true", () => {
    const fn = mcpExpose({ hide: true });
    const schema = getSchema(fn);
    assert.equal(schema.hide, true);
  });

  it("mcpExpose({ tags: ['x'] }) → stored tags is a copy; mutating original does not affect stored", () => {
    const tags = ["x"];
    const fn = mcpExpose({ tags });
    const schema = getSchema(fn);
    // Mutate original
    tags.push("y");
    assert.deepEqual(schema.tags, ["x"]);
  });
});
