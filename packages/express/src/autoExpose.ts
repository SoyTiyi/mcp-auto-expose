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
  const opts: Required<AutoExposeOptions> = {
    strictSchema: options.strictSchema ?? true,
    eager: options.eager ?? false,
    basePath: options.basePath ?? "",
  };

  let cache: MCPTool[] | undefined;

  function buildCatalog(): MCPTool[] {
    const registry = new ToolRegistry();
    for (const descriptor of walkRoutes(app, opts)) {
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
