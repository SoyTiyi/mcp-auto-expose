import { describe, it, expect } from "vitest";
import { checkOrigin } from "./origin.js";

describe("checkOrigin", () => {
  it("undefined origin + empty whitelist → ok: true (no-browser risk)", () => {
    const result = checkOrigin(undefined, []);
    expect(result).toEqual({ ok: true });
  });

  it("undefined origin + non-empty whitelist → ok: true (no browser rebinding risk)", () => {
    const result = checkOrigin(undefined, ["https://app.local"]);
    expect(result).toEqual({ ok: true });
  });

  it("matching origin + whitelist → ok: true", () => {
    const result = checkOrigin("https://app.local", ["https://app.local"]);
    expect(result).toEqual({ ok: true });
  });

  it("matching origin case-insensitively → ok: true", () => {
    const result = checkOrigin("HTTPS://APP.LOCAL", ["https://app.local"]);
    expect(result).toEqual({ ok: true });
  });

  it("origin not in whitelist → ok: false, status: 403, reason: origin-not-allowed", () => {
    const result = checkOrigin("https://app.local", ["https://other.local"]);
    expect(result).toEqual({ ok: false, status: 403, reason: "origin-not-allowed" });
  });

  it("origin present + empty whitelist → ok: false, status: 403, reason: no-whitelist", () => {
    const result = checkOrigin("https://evil.example", []);
    expect(result).toEqual({ ok: false, status: 403, reason: "no-whitelist" });
  });
});
