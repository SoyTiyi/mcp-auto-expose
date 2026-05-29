// Smoke: verifies re-export from core works
import {
  encodeHeaderValue,
  validateAndMergeHeaderParams,
  MCP_PARAM_PREFIX,
} from "./headerParams.js";
import { describe, it, expect } from "vitest";

describe("headerParams shim", () => {
  it("re-exports from core", () => {
    expect(typeof encodeHeaderValue).toBe("function");
    expect(typeof validateAndMergeHeaderParams).toBe("function");
    expect(MCP_PARAM_PREFIX).toBe("mcp-param-");
  });
});
