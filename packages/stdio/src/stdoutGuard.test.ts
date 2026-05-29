import { describe, it, afterEach, expect } from "vitest";

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
    expect(isStdoutGuardInstalled()).toBe(false);
  });

  it("reports installed after installStdoutGuard()", () => {
    installStdoutGuard();
    expect(isStdoutGuardInstalled()).toBe(true);
  });

  it("redirects console.log to stderr, not stdout", () => {
    const stdout = captureStdout();
    const stderr = captureStderr();
    try {
      installStdoutGuard();
      console.log("hello from log");
      expect(stdout.lines.length).toBe(0);
      expect(
        stderr.lines.some((l) => l.includes("hello from log")),
        "console.log must write to stderr",
      ).toBeTruthy();
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
      expect(stdout.lines.length).toBe(0);
      expect(
        stderr.lines.some((l) => l.includes("warning text")),
        "console.warn must write to stderr",
      ).toBeTruthy();
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
      expect(stdout.lines.length).toBe(0);
      expect(stderr.lines.some((l) => l.includes("info text"))).toBeTruthy();
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
      expect(stdout.lines.length).toBe(0);
      expect(stderr.lines.some((l) => l.includes("error text"))).toBeTruthy();
    } finally {
      stdout.stop();
      stderr.stop();
    }
  });

  it("restores console after restoreStdoutGuard()", () => {
    installStdoutGuard();
    // Verify guard is active: console.log must NOT go to stderr via the direct write path
    const stderrBefore = captureStderr();
    console.log("pre-restore message");
    stderrBefore.stop();
    expect(
      stderrBefore.lines.some((l) => l.includes("pre-restore message")),
      "guard should redirect to stderr before restore",
    ).toBeTruthy();

    restoreStdoutGuard();
    expect(isStdoutGuardInstalled()).toBe(false);
    // After restore, the guard's stderr redirect is removed — console.log is back to original.
    // We verify this by checking stderr does NOT receive the message via the guard.
    const stderrAfter = captureStderr();
    console.log("post-restore message");
    stderrAfter.stop();
    expect(
      stderrAfter.lines.some((l) => l.includes("post-restore message")),
      "after restore, guard must NOT redirect console.log to stderr",
    ).toBeFalsy();
  });

  it("installStdoutGuard is idempotent — calling twice does not double-patch", () => {
    installStdoutGuard();
    const logRef1 = console.log;
    installStdoutGuard();
    const logRef2 = console.log;
    expect(logRef1).toBe(logRef2);
    expect(isStdoutGuardInstalled()).toBe(true);
  });

  it("formats multiple arguments with util.format", () => {
    const stderr = captureStderr();
    try {
      installStdoutGuard();
      console.log("value is %d and %s", 42, "hello");
      expect(
        stderr.lines.some((l) => l.includes("42") && l.includes("hello")),
        "multiple args should be formatted via util.format",
      ).toBeTruthy();
    } finally {
      stderr.stop();
    }
  });
});
