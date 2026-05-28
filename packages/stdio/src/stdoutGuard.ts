import { format } from "node:util";

const PATCHED_METHODS = [
  "log",
  "info",
  "warn",
  "error",
  "debug",
  "trace",
  "dir",
  "group",
  "groupCollapsed",
  "groupEnd",
  "table",
  "count",
  "countReset",
  "time",
  "timeLog",
  "timeEnd",
  "assert",
] as const;

type PatchedMethod = (typeof PATCHED_METHODS)[number];
type ConsoleLike = Record<string, (...args: unknown[]) => void>;

let savedMethods: Partial<Record<PatchedMethod, (...args: unknown[]) => void>> | null = null;

function toStderr(...args: unknown[]): void {
  process.stderr.write(format(...args) + "\n");
}

export function installStdoutGuard(): void {
  if (savedMethods !== null) return; // idempotent

  const c = console as unknown as ConsoleLike;
  savedMethods = {} as Record<PatchedMethod, (...args: unknown[]) => void>;
  for (const method of PATCHED_METHODS) {
    (savedMethods as ConsoleLike)[method] = c[method] as (...args: unknown[]) => void;
    c[method] = toStderr;
  }
}

export function restoreStdoutGuard(): void {
  if (savedMethods === null) return;
  const c = console as unknown as ConsoleLike;
  for (const method of PATCHED_METHODS) {
    const saved = (savedMethods as ConsoleLike)[method];
    if (saved) c[method] = saved;
  }
  savedMethods = null;
}

export function isStdoutGuardInstalled(): boolean {
  return savedMethods !== null;
}
