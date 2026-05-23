import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkOrigin } from "./origin.js";

describe("checkOrigin", () => {
  it("undefined origin + empty whitelist → ok: true (no-browser risk)", () => {
    const result = checkOrigin(undefined, []);
    assert.deepEqual(result, { ok: true });
  });

  it("undefined origin + non-empty whitelist → ok: true (no browser rebinding risk)", () => {
    const result = checkOrigin(undefined, ["https://app.local"]);
    assert.deepEqual(result, { ok: true });
  });

  it("matching origin + whitelist → ok: true", () => {
    const result = checkOrigin("https://app.local", ["https://app.local"]);
    assert.deepEqual(result, { ok: true });
  });

  it("matching origin case-insensitively → ok: true", () => {
    const result = checkOrigin("HTTPS://APP.LOCAL", ["https://app.local"]);
    assert.deepEqual(result, { ok: true });
  });

  it("origin not in whitelist → ok: false, status: 403, reason: origin-not-allowed", () => {
    const result = checkOrigin("https://app.local", ["https://other.local"]);
    assert.deepEqual(result, { ok: false, status: 403, reason: "origin-not-allowed" });
  });

  it("origin present + empty whitelist → ok: false, status: 403, reason: no-whitelist", () => {
    const result = checkOrigin("https://evil.example", []);
    assert.deepEqual(result, { ok: false, status: 403, reason: "no-whitelist" });
  });
});
