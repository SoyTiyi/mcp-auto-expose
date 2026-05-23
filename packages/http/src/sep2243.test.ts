import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateSep2243 } from "./sep2243.js";

describe("validateSep2243", () => {
  it("malformed body (null) → ok: false, reason: malformed-body", () => {
    const result = validateSep2243({ "mcp-method": "tools/list" }, null);
    assert.deepEqual(result, { ok: false, reason: "malformed-body" });
  });

  it("malformed body (missing method) → ok: false, reason: malformed-body", () => {
    const result = validateSep2243({ "mcp-method": "tools/list" }, { id: 1 });
    assert.deepEqual(result, { ok: false, reason: "malformed-body" });
  });

  it("missing mcp-method header → ok: false, reason: missing-header", () => {
    const result = validateSep2243({}, { method: "tools/list", id: 1 });
    assert.deepEqual(result, { ok: false, reason: "missing-header" });
  });

  it('method mismatch: header="tools/list" body={method:"tools/call"} → ok: false, reason: method-mismatch', () => {
    const result = validateSep2243(
      { "mcp-method": "tools/list" },
      { method: "tools/call", params: { name: "my_tool" }, id: 1 },
    );
    assert.deepEqual(result, { ok: false, reason: "method-mismatch" });
  });

  it("tools/call with matching method+name → ok: true, mcp: { method: tools/call, name: my_tool }", () => {
    const result = validateSep2243(
      { "mcp-method": "tools/call", "mcp-name": "my_tool" },
      { method: "tools/call", params: { name: "my_tool" }, id: 1 },
    );
    assert.deepEqual(result, { ok: true, mcp: { method: "tools/call", name: "my_tool" } });
  });

  it("tools/call with missing mcp-name → ok: false, reason: missing-header", () => {
    const result = validateSep2243(
      { "mcp-method": "tools/call" },
      { method: "tools/call", params: { name: "my_tool" }, id: 1 },
    );
    assert.deepEqual(result, { ok: false, reason: "missing-header" });
  });

  it("tools/call with name mismatch → ok: false, reason: name-mismatch", () => {
    const result = validateSep2243(
      { "mcp-method": "tools/call", "mcp-name": "wrong_tool" },
      { method: "tools/call", params: { name: "my_tool" }, id: 1 },
    );
    assert.deepEqual(result, { ok: false, reason: "name-mismatch" });
  });

  it("tools/list with matching method, no mcp-name required → ok: true, mcp: { method: tools/list, name: '' }", () => {
    const result = validateSep2243(
      { "mcp-method": "tools/list" },
      { method: "tools/list", id: 1 },
    );
    assert.deepEqual(result, { ok: true, mcp: { method: "tools/list", name: "" } });
  });

  it("initialize with matching header → ok: true, mcp: { method: initialize, name: '' }", () => {
    const result = validateSep2243(
      { "mcp-method": "initialize" },
      { method: "initialize", params: { protocolVersion: "2024-11-05" }, id: 1 },
    );
    assert.deepEqual(result, { ok: true, mcp: { method: "initialize", name: "" } });
  });
});
