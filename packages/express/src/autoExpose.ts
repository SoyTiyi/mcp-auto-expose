import type { Express } from "express";
import type { MCPTool } from "@mcp-auto-expose/core";
import { ToolRegistry, resolveTool } from "@mcp-auto-expose/core";
import { walkRoutes } from "./walkRoutes.js";
import type { WalkOptions } from "./walkRoutes.js";

export interface AutoExposeOptions extends WalkOptions {
  eager?: boolean; // default: false
}

export interface AutoExposeHandle {
  /** Walk lazy + memoized. Idempotente. */
  tools(): MCPTool[];
  /** Re-walk forzado: limpia ToolRegistry y reconstruye el catálogo. */
  refresh(): MCPTool[];
}

export function autoExpose(app: Express, options: AutoExposeOptions = {}): AutoExposeHandle {
  const opts = {
    strictSchema: options.strictSchema ?? true,
    eager: options.eager ?? false,
    basePath: options.basePath ?? "",
  };

  // WeakMap: records handle → mountPath for sub-routers mounted via app.use()
  const mountRegistry = new WeakMap<object, string>();

  // Wrap app.use to intercept future registrations (Express 5.1+ compat)
  const _originalUse = app.use.bind(app) as (...args: unknown[]) => unknown;
  (app.use as unknown) = function (...args: unknown[]): unknown {
    if (typeof args[0] === "string") {
      const mountPath = args[0] as string;
      // Flatten and record all handler functions (including arrays)
      const handlers = (args.slice(1) as unknown[]).flat(Infinity);
      for (const h of handlers) {
        if (h !== null && typeof h === "function") {
          mountRegistry.set(h as object, mountPath);
        }
      }
    }
    return _originalUse(...args);
  };

  let cache: MCPTool[] | undefined;

  function buildCatalog(): MCPTool[] {
    const registry = new ToolRegistry();
    for (const descriptor of walkRoutes(app, { ...opts, mountRegistry })) {
      registry.register(resolveTool(descriptor));
    }
    return registry.list();
  }

  if (opts.eager) cache = buildCatalog();

  return {
    tools(): MCPTool[] {
      if (!cache) cache = buildCatalog();
      return cache;
    },
    refresh(): MCPTool[] {
      cache = buildCatalog();
      return cache;
    },
  };
}
