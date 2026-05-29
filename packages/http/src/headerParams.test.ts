// Smoke: verifies re-export from core works
import { encodeHeaderValue, validateAndMergeHeaderParams, MCP_PARAM_PREFIX } from "./headerParams.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("headerParams shim", () => {
  it("re-exports from core", () => {
    assert.equal(typeof encodeHeaderValue, "function");
    assert.equal(typeof validateAndMergeHeaderParams, "function");
    assert.equal(MCP_PARAM_PREFIX, "mcp-param-");
  });
});
