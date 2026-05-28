import type { RouteDescriptor, RouteSchema, HTTPMethod } from "@mcp-auto-expose/core";
import { MCP_EXPOSE_SYMBOL } from "./mcpExpose.js";
import { warn } from "./warn.js";

// Internal type — not exported
type ExpressLayer = {
  name?: string;
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
    stack: Array<{ handle: unknown; name?: string }>;
  };
  handle?: { stack?: ExpressLayer[] } & ((...a: unknown[]) => void);
  regexp?: RegExp & { fast_slash?: boolean };
  path?: string; // Express 5.0.x: populated on sub-router layers at construction time
  slash?: boolean; // Express 5.1+: true when mounted at "/"
};

export interface WalkOptions {
  strictSchema?: boolean; // default: true (applied in walk())
  includeHead?: boolean; // default: false — HEAD excluded to match Fastify behaviour
  basePath?: string; // initial mountPath — ADDITIVE prefix for all discovered URLs
  /** Internal: supplied by autoExpose to enable Express 5.1+ mount path recovery */
  mountRegistry?: WeakMap<object, string>;
}

function getRootStack(app: unknown): ExpressLayer[] {
  const a = app as {
    router?: { stack: ExpressLayer[] };
    _router?: { stack: ExpressLayer[] };
    lazyrouter?: () => void;
  };
  if (a.router?.stack) return a.router.stack; // Express 5: lazy public getter
  if (typeof a.lazyrouter === "function") a.lazyrouter(); // Express 4: force lazy init
  if (a._router?.stack) return a._router.stack; // Express 4: after init
  warn("empty-router", {});
  return [];
}

export function walkRoutes(app: unknown, opts: WalkOptions): RouteDescriptor[] {
  const out: RouteDescriptor[] = [];
  const seen = new Set<string>();
  const basePath = opts.basePath ?? "";
  walk(getRootStack(app), basePath, out, seen, opts);
  return out;
}

function walk(
  stack: ExpressLayer[],
  mountPath: string,
  out: RouteDescriptor[],
  seen: Set<string>,
  opts: WalkOptions,
): void {
  for (const layer of stack) {
    if (layer.route) {
      // Terminal: route registered directly on this layer
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];

      for (const p of paths) {
        const url = joinPath(mountPath, p);
        const verbs = methodsOf(layer.route.methods, url, opts);

        for (const verb of verbs) {
          const key = `${verb} ${url}`;
          if (seen.has(key)) {
            warn("duplicate", { verb, url });
            continue;
          }
          seen.add(key);

          const schema = extractSchema(layer.route.stack);

          if (opts.strictSchema !== false && !schema) {
            // strictSchema default: true (unlike Fastify)
            warn("missing-schema-strict", { verb, url });
            continue;
          }
          if (schema?.hide) continue; // silent opt-out

          out.push({ framework: "express", method: verb, url, schema });
        }
      }
    } else if (layer.name === "router" && layer.handle) {
      // Sub-router: descend recursively
      const subStack = (layer.handle as { stack?: ExpressLayer[] }).stack;
      if (!subStack) {
        warn("malformed-router-layer", { mountPath });
        continue;
      }

      const childMount = recoverMountPath(layer, mountPath, opts.mountRegistry);
      walk(subStack, joinPath(mountPath, childMount), out, seen, opts);
    }
    // Any other middleware (body-parser, cors, etc.) => ignore
  }
}

function joinPath(parent: string, child: string): string {
  const raw = `${parent}/${child}`.replace(/\/+/g, "/");
  return raw.length > 1 ? raw.replace(/\/$/, "") : raw;
}

const VALID_METHODS = new Set<string>(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function methodsOf(methods: Record<string, boolean>, url: string, opts: WalkOptions): HTTPMethod[] {
  return Object.keys(methods)
    .filter((m) => methods[m] === true && m !== "_all")
    .map((m) => m.toUpperCase())
    .filter((m): m is HTTPMethod => {
      if (m === "HEAD" && !opts.includeHead) return false;
      if (VALID_METHODS.has(m)) return true;
      warn("unknown-method", { verb: m, url });
      return false;
    });
}

function recoverMountPath(
  layer: ExpressLayer,
  parentMount: string,
  mountRegistry?: WeakMap<object, string>,
): string {
  // Express 5.0.x: layer.path is populated at construction time
  if (layer.path && typeof layer.path === "string") return layer.path;

  // Express 5.1+ (router@2.x): mount registry populated by autoExpose wrapper
  if (mountRegistry && layer.handle && typeof layer.handle === "function") {
    const recorded = mountRegistry.get(layer.handle as object);
    if (recorded !== undefined) return recorded;
  }

  const regexp = layer.regexp;
  if (!regexp) {
    // Express 5.1+: layer has matchers[] instead of regexp; path is not accessible post-registration.
    // Only warn if it's a real sub-router (not a fast-slash "/" mount)
    if (!layer.slash) {
      warn("unknown-layer-shape", {
        parentMount,
        hint: "call autoExpose(app) before app.use(path, router) for Express 5.1+ mount path recovery",
      });
    }
    return "";
  }

  // Mounted at "/" — fast_slash shortcut (Express 4)
  if (regexp.fast_slash === true) return "";

  // Express 4 canonical regex pattern (from express-list-endpoints)
  const match = /^\^\\\/(?:\(\?:\(\[\^\\\/]\+\?\)\))?(.*?)\\\/\?\(\?=\\\/\|\$\)/i.exec(
    regexp.source ?? "",
  );
  if (match?.[1]) {
    return `/${match[1].replace(/\\\//g, "/")}`;
  }

  warn("regex-parse-failed", { source: regexp.source ?? "", parentMount });
  return ""; // graceful degradation
}

const SCHEMA_KEY = MCP_EXPOSE_SYMBOL;

function extractSchema(routeStack: Array<{ handle: unknown }>): RouteSchema | undefined {
  let found: RouteSchema | undefined;
  let extra = 0;

  for (const sub of routeStack) {
    const h = sub.handle;
    if (typeof h !== "function") continue;
    const schema = (h as unknown as Record<symbol, RouteSchema>)[SCHEMA_KEY];
    if (!schema) continue;
    if (!found) {
      found = schema;
    } else {
      extra++;
    }
  }

  if (extra > 0) {
    warn("multiple-mcpExpose", { count: extra + 1, hint: "first is used" });
  }
  return found;
}
