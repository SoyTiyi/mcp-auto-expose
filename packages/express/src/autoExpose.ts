import type { Express } from "express";
import type { MCPTool } from "@mcp-auto-expose/core";
import { ToolRegistry, resolveTool } from "@mcp-auto-expose/core";
import { walkRoutes } from "./walkRoutes.js";
import type { WalkOptions } from "./walkRoutes.js";

export interface AutoExposeOptions extends WalkOptions {
  eager?: boolean; // default: false
}

// Unexported symbol used to attach an internal method to the handle
export const _mount = Symbol("mount");

// Internal interface — not exported; only used within this file and mount()
interface InternalHandle extends AutoExposeHandle {
  readonly [_mount]: (prefix: string, subApp: unknown) => void;
}

export interface AutoExposeHandle {
  /** Walk lazy + memoized. Idempotente. */
  tools(): MCPTool[];
  /** Re-walk forzado: limpia ToolRegistry y reconstruye el catálogo. */
  refresh(): MCPTool[];
}

type MountEntry = { prefix: string; subApp: unknown };

export function autoExpose(app: Express, options: AutoExposeOptions = {}): AutoExposeHandle {
  const opts = {
    strictSchema: options.strictSchema ?? true,
    eager: options.eager ?? false,
    basePath: options.basePath ?? "",
  };

  // Registry of explicitly mounted sub-routers (populated via mount())
  const mounts: MountEntry[] = [];

  let cache: MCPTool[] | undefined;

  function buildCatalog(): MCPTool[] {
    const registry = new ToolRegistry();
    // Build a set of explicitly mounted handles to skip during top-level walk
    const skipHandles = new Set<object>(
      mounts
        .map((m) => m.subApp)
        .filter((s): s is object => s !== null && (typeof s === "object" || typeof s === "function")),
    );
    // Walk top-level app routes (skipping explicitly mounted sub-routers)
    for (const descriptor of walkRoutes(app, { ...opts, skipHandles })) {
      registry.register(resolveTool(descriptor));
    }
    // Walk each explicitly mounted sub-router with its known prefix
    for (const { prefix, subApp } of mounts) {
      for (const descriptor of walkRoutes(subApp, { ...opts, basePath: prefix })) {
        registry.register(resolveTool(descriptor));
      }
    }
    return registry.list();
  }

  if (opts.eager) cache = buildCatalog();

  const handle: InternalHandle = {
    tools(): MCPTool[] {
      if (!cache) cache = buildCatalog();
      return cache;
    },
    refresh(): MCPTool[] {
      cache = buildCatalog();
      return cache;
    },
    [_mount](prefix: string, subApp: unknown): void {
      mounts.push({ prefix, subApp });
      if (opts.eager) {
        // Re-capture the snapshot immediately so later route additions don't slip in
        cache = buildCatalog();
      } else {
        cache = undefined; // invalidate cache — will be rebuilt lazily on next tools() call
      }
    },
  };

  return handle;
}

/**
 * Register a sub-router (or sub-app) mounted at `prefix` with the given handle.
 *
 * Call this immediately after `app.use(prefix, subApp)`:
 *
 * ```ts
 * app.use("/api", router);
 * mount(handle, "/api", router);
 * ```
 */
export function mount(
  handle: AutoExposeHandle,
  prefix: string,
  subApp: unknown,
): void {
  (handle as InternalHandle)[_mount](prefix, subApp);
}
