import { describe, it, expect } from "vitest";
import { validateSep2243 } from "./sep2243.js";

describe("validateSep2243", () => {
  it("malformed body (null) → ok: false, reason: malformed-body", () => {
    const result = validateSep2243({ "mcp-method": "tools/list" }, null);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("malformed-body");
  });

  it("malformed body (missing method) → ok: false, reason: malformed-body", () => {
    const result = validateSep2243({ "mcp-method": "tools/list" }, { id: 1 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("malformed-body");
  });

  it("missing mcp-method header → ok: false, reason: missing-header", () => {
    const result = validateSep2243({}, { method: "tools/list", id: 1 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-header");
  });

  it('method mismatch: header="tools/list" body={method:"tools/call"} → ok: false, reason: method-mismatch', () => {
    const result = validateSep2243(
      { "mcp-method": "tools/list" },
      { method: "tools/call", params: { name: "my_tool" }, id: 1 },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("method-mismatch");
  });

  it("tools/call with matching method+name → ok: true, mcp: { method: tools/call, name: my_tool }", () => {
    const result = validateSep2243(
      { "mcp-method": "tools/call", "mcp-name": "my_tool" },
      { method: "tools/call", params: { name: "my_tool" }, id: 1 },
    );
    expect(result).toEqual({ ok: true, mcp: { method: "tools/call", name: "my_tool" } });
  });

  it("tools/call with missing mcp-name → ok: false, reason: missing-header", () => {
    const result = validateSep2243(
      { "mcp-method": "tools/call" },
      { method: "tools/call", params: { name: "my_tool" }, id: 1 },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing-header");
  });

  it("tools/call with name mismatch → ok: false, reason: name-mismatch", () => {
    const result = validateSep2243(
      { "mcp-method": "tools/call", "mcp-name": "wrong_tool" },
      { method: "tools/call", params: { name: "my_tool" }, id: 1 },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("name-mismatch");
  });

  it("tools/list with matching method, no mcp-name required → ok: true, mcp: { method: tools/list, name: '' }", () => {
    const result = validateSep2243({ "mcp-method": "tools/list" }, { method: "tools/list", id: 1 });
    expect(result).toEqual({ ok: true, mcp: { method: "tools/list", name: "" } });
  });

  it("initialize with matching header → ok: true, mcp: { method: initialize, name: '' }", () => {
    const result = validateSep2243(
      { "mcp-method": "initialize" },
      { method: "initialize", params: { protocolVersion: "2024-11-05" }, id: 1 },
    );
    expect(result).toEqual({ ok: true, mcp: { method: "initialize", name: "" } });
  });
});

describe("validateSep2243 detail string", () => {
  it("method-mismatch outcome carries a human-readable detail", () => {
    const r = validateSep2243(
      { "mcp-method": "tools/list" },
      { method: "tools/call", params: { name: "x" }, id: 1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("method-mismatch");
      expect(r.detail ?? "").toMatch(/method/i);
    }
  });

  it("name-mismatch outcome carries a detail mentioning the names", () => {
    const r = validateSep2243(
      { "mcp-method": "tools/call", "mcp-name": "wrong" },
      { method: "tools/call", params: { name: "my_tool" }, id: 1 },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("name-mismatch");
      expect(r.detail ?? "").toMatch(/my_tool|wrong/);
    }
  });

  it("missing-header outcome detail names the missing header", () => {
    const r = validateSep2243({}, { method: "tools/list", id: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("missing-header");
      expect(r.detail ?? "").toMatch(/Mcp-Method/);
    }
  });
});
