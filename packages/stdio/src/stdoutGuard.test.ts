import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";

// Capture stderr writes for assertion
function captureStderr(): { lines: string[]; stop: () => void } {
  const lines: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
    return true;
  }) as typeof process.stderr.write;
  return {
    lines,
    stop: () => {
      process.stderr.write = original;
    },
  };
}

// Capture stdout writes for assertion
function captureStdout(): { lines: string[]; stop: () => void } {
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    lines.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
    return true;
  }) as typeof process.stdout.write;
  return {
    lines,
    stop: () => {
      process.stdout.write = original;
    },
  };
}

import { installStdoutGuard, restoreStdoutGuard, isStdoutGuardInstalled } from "./stdoutGuard.js";

describe("stdoutGuard", () => {
  afterEach(() => {
    // Always restore after each test to keep state clean
    restoreStdoutGuard();
  });

  it("is not installed by default", () => {
    assert.equal(isStdoutGuardInstalled(), false);
  });

  it("reports installed after installStdoutGuard()", () => {
    installStdoutGuard();
    assert.equal(isStdoutGuardInstalled(), true);
  });

  it("redirects console.log to stderr, not stdout", () => {
    const stdout = captureStdout();
    const stderr = captureStderr();
    try {
      installStdoutGuard();
      console.log("hello from log");
      assert.equal(stdout.lines.length, 0, "console.log must not write to stdout");
      assert.ok(
        stderr.lines.some((l) => l.includes("hello from log")),
        "console.log must write to stderr",
      );
    } finally {
      stdout.stop();
      stderr.stop();
    }
  });

  it("redirects console.warn to stderr, not stdout", () => {
    const stdout = captureStdout();
    const stderr = captureStderr();
    try {
      installStdoutGuard();
      console.warn("warning text");
      assert.equal(stdout.lines.length, 0, "console.warn must not write to stdout");
      assert.ok(
        stderr.lines.some((l) => l.includes("warning text")),
        "console.warn must write to stderr",
      );
    } finally {
      stdout.stop();
      stderr.stop();
    }
  });

  it("redirects console.info to stderr, not stdout", () => {
    const stdout = captureStdout();
    const stderr = captureStderr();
    try {
      installStdoutGuard();
      console.info("info text");
      assert.equal(stdout.lines.length, 0);
      assert.ok(stderr.lines.some((l) => l.includes("info text")));
    } finally {
      stdout.stop();
      stderr.stop();
    }
  });

  it("redirects console.error to stderr (was already stderr, stays stderr)", () => {
    const stdout = captureStdout();
    const stderr = captureStderr();
    try {
      installStdoutGuard();
      console.error("error text");
      assert.equal(stdout.lines.length, 0);
      assert.ok(stderr.lines.some((l) => l.includes("error text")));
    } finally {
      stdout.stop();
      stderr.stop();
    }
  });

  it("restores console after restoreStdoutGuard()", () => {
    installStdoutGuard();
    restoreStdoutGuard();
    assert.equal(isStdoutGuardInstalled(), false);
    // After restore, console.log should go to stdout again
    const stdout = captureStdout();
    try {
      console.log("restored log");
      assert.ok(
        stdout.lines.some((l) => l.includes("restored log")),
        "console.log should write to stdout after restore",
      );
    } finally {
      stdout.stop();
    }
  });

  it("installStdoutGuard is idempotent — calling twice does not double-patch", () => {
    installStdoutGuard();
    const logRef1 = console.log;
    installStdoutGuard();
    const logRef2 = console.log;
    assert.equal(logRef1, logRef2, "second install must not replace the already-patched method");
    assert.equal(isStdoutGuardInstalled(), true);
  });

  it("formats multiple arguments with util.format", () => {
    const stderr = captureStderr();
    try {
      installStdoutGuard();
      console.log("value is %d and %s", 42, "hello");
      assert.ok(
        stderr.lines.some((l) => l.includes("42") && l.includes("hello")),
        "multiple args should be formatted via util.format",
      );
    } finally {
      stderr.stop();
    }
  });
});
