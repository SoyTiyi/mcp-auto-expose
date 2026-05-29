# Phase 3 — Analytics Engine and Express.js Adapter

> **Status:** Specification pending human approval. Methodology: Spec-Driven Development.
> **Anchor:** `docs/principal-document.txt` §38–§41 (Express introspection), §184–§191 (Phase 4 of roadmap).
> **Date:** 2026-05-23.
> **Approved predecessors:** Phase 1 (Fastify adapter), Phase 2 (stdio transport).

## 1. Objective

Build `@mcp-auto-expose/express` (`packages/express`): a reflective engine that recursively iterates `app.router` (v5) / `app._router` (v4) after route registration, reads Zod schemas injected via `mcpExpose(spec)` middleware, converts them to JSON Schema Draft 7, and produces `MCPTool[]` with the **exact same shape** as the Fastify adapter so that the Phase 2 MCP server consumes them without changes.

**Out of scope:**

- Real dispatch of `tools/call` to Express handlers (requires extending `_source` in core; later phase).
- Streamable HTTP, SEP-2243, SEP-2549, SEP-414 (new Phase 4).
- Runtime HTTP validation via `mcpExpose` (possible future extension with `validate:true` flag, out of MVP).

## 2. Architecture

```
+------------------+   autoExpose(app)    +--------------------------+
| Host application | -------------------> | packages/express         |
| (Express 4 or 5) |                      | @mcp-auto-expose/express |
+------------------+                      +-----------+--------------+
        |                                             |
        | app.router (v5)                             |
        | or app._router (v4, lazy)                   | RouteDescriptor[]
        |                                             |
        v                                             v
+------------------+                      +--------------------------+
| walkRoutes()     |  ─── recursive ────> | resolveTool (core)       |
| + extractSchema  |                      | ToolRegistry (core)      |
+------------------+                      +--------------------------+
        ^                                             |
        |                                             v  MCPTool[]
| app.use('/api', router)                  +--------------------------+
| router.get('/users',                     | startStdio({ tools })    |
|   mcpExpose({ body: z }),   ─────────>   | (packages/stdio)         |
|   handler)                               +--------------------------+
```

### 2.1. Packages to create

- `packages/express` → `@mcp-auto-expose/express`
  - `warn.ts`: single logging helper to `stderr` with prefix `[mcp-auto-expose:express]`.
  - `zodConvert.ts`: `convertCached(schema)` — Zod → JSON Schema Draft 7 with WeakMap cache.
  - `mcpExpose.ts`: `mcpExpose(spec): RequestHandler`, `MCP_EXPOSE_SYMBOL`, `specToRouteSchema`.
  - `walkRoutes.ts`: recursive walker + helpers `joinPath`, `methodsOf`, `recoverMountPath`, `extractSchema`.
  - `autoExpose.ts`: `autoExpose(app, options?)` factory — `AutoExposeHandle` with lazy+memoized `tools()` and `refresh()`.
  - `src/index.ts`: public exports barrel.

- `apps/dev-sandbox/src/express-main.ts` — new smoke entry-point (does not modify the existing `main.ts`).

### 2.2. No changes to `@mcp-auto-expose/core`

`RouteDescriptor.framework: "fastify" | "express"` already supports Express in `packages/core/src/types.ts:26-31`. `RouteSchema` already covers `{body?, querystring?, params?, description?, summary?, tags?, hide?}`. `resolveTool` and `ToolRegistry` are reused without modification.

## 3. Detailed technical design

### 3.1. Public API of `@mcp-auto-expose/express`

```ts
// packages/express/src/index.ts
import type { Express } from "express";
import type { MCPTool } from "@mcp-auto-expose/core";

export interface AutoExposeOptions {
  /**
   * Default: true (opt-in).
   * Only routes with mcpExpose() are exposed.
   * NOTE: diverges from Fastify (default false) for security posture —
   * Express is common in legacy apps where accidental exposure of
   * admin endpoints is a concrete risk.
   */
  strictSchema?: boolean;
  /**
   * Default: false (lazy).
   * If true, the walker runs in autoExpose() instead of in tools().
   * Useful for detecting configuration errors at bootstrap.
   */
  eager?: boolean;
  /**
   * URL prefix to strip from descriptors before name generation.
   * E.g.: basePath: "/api" → GET /api/users is registered as GET /users → list_users.
   */
  basePath?: string;
}

export interface AutoExposeHandle {
  /** Lazy + memoized walk. Idempotent. */
  tools(): MCPTool[];
  /** Forced re-walk: clears ToolRegistry and rebuilds the catalog. */
  refresh(): MCPTool[];
}

export function autoExpose(app: Express, options?: AutoExposeOptions): AutoExposeHandle;
export { mcpExpose } from "./mcpExpose.js";
export type { McpExposeSpec } from "./mcpExpose.js";
export { MCP_EXPOSE_SYMBOL } from "./mcpExpose.js";
```

**Expected usage (from `apps/dev-sandbox/src/express-main.ts`):**

```ts
import express from "express";
import { z } from "zod";
import { autoExpose, mcpExpose } from "@mcp-auto-expose/express";
import { startStdio } from "@mcp-auto-expose/stdio";

const app = express();
app.use(express.json());

const router = express.Router();

router.get("/users", mcpExpose({ description: "List users" }), async (_req, res) => res.json([]));

router.get(
  "/users/:id",
  mcpExpose({
    params: z.object({ id: z.string() }),
    description: "Get user by id",
  }),
  async (_req, res) => res.json({}),
);

router.post(
  "/users",
  mcpExpose({
    body: z.object({ name: z.string(), email: z.string() }),
    description: "Create user",
  }),
  async (_req, res) => res.status(201).json({}),
);

app.use("/api", router);

const handle = autoExpose(app, { strictSchema: true });
await startStdio({ name: "express-sandbox", version: "0.0.0", tools: handle.tools() });
```

### 3.2. `mcpExpose` — decorator middleware (pure metadata carrier)

```ts
// packages/express/src/mcpExpose.ts
import type { RequestHandler } from "express";
import type { RouteSchema } from "@mcp-auto-expose/core";
import { z } from "zod";
import { specToRouteSchema } from "./zodConvert.js";

export const MCP_EXPOSE_SYMBOL: unique symbol = Symbol.for("mcp-auto-expose.schema");

export interface McpExposeSpec {
  body?: z.ZodTypeAny;
  /**
   * Express-idiomatic name for query parameters.
   * Mapped internally to RouteSchema.querystring (core.flattenSchema contract).
   */
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  description?: string;
  summary?: string;
  tags?: string[];
  /** If true, the route is omitted from the MCP catalog (per-route opt-out). */
  hide?: boolean;
}

export function mcpExpose(spec: McpExposeSpec): RequestHandler {
  const routeSchema = specToRouteSchema(spec); // conversion at registration time
  const middleware: RequestHandler = (_req, _res, next) => next(); // no-op at runtime
  (middleware as unknown as Record<symbol, RouteSchema>)[MCP_EXPOSE_SYMBOL] = routeSchema;
  return middleware;
}
```

**Decisions and rationale:**

- **`Symbol.for("mcp-auto-expose.schema")`**: the global symbol registry guarantees the same key is recognized even if the package appears twice in the module tree (dual-bundle, npm dedupe quirks). An exported WeakMap would fail silently in that scenario. A string key would collide with user code. The symbol is non-enumerable in `Object.keys` and `JSON.stringify`, avoiding leaks in logs.

- **Pure `next()`**: zero cost in hot path. HTTP validation is left to the user (zod-express-middleware, manual `.parse()`). There is no `validate` flag in this phase — if added in the future, it is backwards compatible.

- **Type `RequestHandler`**: the returned middleware type-checks without casts for the user in `app.get(path, mcpExpose({...}), handler)`.

- **Conversion at registration time**: `specToRouteSchema` (which calls `zodToJsonSchema`) runs once when the user calls `mcpExpose(...)`, not on each request or during the walk. The result is stored in the middleware's symbol.

### 3.3. Zod → JSON Schema Draft 7 conversion (`zodConvert.ts`)

```ts
// packages/express/src/zodConvert.ts
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import type { RouteSchema } from "@mcp-auto-expose/core";
import type { McpExposeSpec } from "./mcpExpose.js";
import { warn } from "./warn.js";

const conversionCache = new WeakMap<z.ZodTypeAny, Record<string, unknown>>();

function convertCached(schema: z.ZodTypeAny): Record<string, unknown> {
  const cached = conversionCache.get(schema);
  if (cached) return cached;

  let out: Record<string, unknown>;
  try {
    out = zodToJsonSchema(schema, {
      target: "jsonSchema7", // MCP Tool.inputSchema requires Draft 7
      $refStrategy: "none", // core.flattenSchema drops $ref; inlining avoids data loss
      // Do NOT pass name: triggers $ref/#/definitions wrapper that would be dropped
    }) as Record<string, unknown>;
  } catch (e) {
    warn("zod-convert-failed", { message: String(e) });
    out = {};
  }

  if (JSON.stringify(out).includes('"$ref"')) {
    warn("schema-has-ref", { hint: "use plain z.object; recursive schemas are simplified to {}" });
  }

  conversionCache.set(schema, out);
  return out;
}

export function specToRouteSchema(spec: McpExposeSpec): RouteSchema {
  return {
    body: spec.body ? convertCached(spec.body) : undefined,
    querystring: spec.query ? convertCached(spec.query) : undefined, // rename query→querystring
    params: spec.params ? convertCached(spec.params) : undefined,
    description: spec.description,
    summary: spec.summary,
    tags: spec.tags ? [...spec.tags] : undefined, // shallow copy
    hide: spec.hide,
  };
}
```

**Rationale for conversion options:**

| Option         | Value           | Why                                                                                                                       |
| -------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `target`       | `"jsonSchema7"` | MCP clients expect Draft 7; Draft 2019-09 includes `unevaluatedProperties` and other constructs not universally supported |
| `$refStrategy` | `"none"`        | `core/flattenSchema.ts:30-40` drops properties with `$ref`; `"none"` inlines everything eliminating data loss             |
| `name`         | not passed      | Triggers `$ref/#/definitions/<name>` wrapper that `flattenSchema` would drop entirely                                     |

**Edge case behavior:**

| Zod Input                      | JSON Schema Output                                                             | Behavior in `core.flattenSchema`                         |
| ------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `z.object({ id: z.string() })` | `{ type: "object", properties: { id: { type: "string" } }, required: ["id"] }` | Normal flattening into `inputSchema`                     |
| `z.string()` (primitive body)  | `{ type: "string" }`                                                           | Wrapped under `properties.body` (flattenSchema.ts:15-18) |
| `z.array(z.number())`          | `{ type: "array", items: { type: "number" } }`                                 | Wrapped under source key                                 |
| `z.discriminatedUnion(...)`    | `{ anyOf: [...] }` (without `type: "object"`)                                  | Wrapped; warning in stderr                               |
| `z.lazy(...)` with cycle       | `{}` (any)                                                                     | Accepts anything; warning                                |

**Memoization**: WeakMap keyed by Zod schema identity. The same `z.object({...})` used in 50 routes is converted once. Identity-based: two instances with the same shape do not share cache (correct behavior).

### 3.4. Recursive walker — `walkRoutes.ts`

#### Internal types (not exported)

```ts
type ExpressLayer = {
  name?: string;
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
    stack: Array<{ handle: unknown; name?: string }>;
  };
  handle?: { stack?: ExpressLayer[] } & ((...a: unknown[]) => void);
  regexp?: RegExp & { fast_slash?: boolean };
  path?: string; // Express 5 in mounted sub-router layers
};
```

#### Entry point

```ts
// packages/express/src/walkRoutes.ts
import type { Express } from "express";
import type { RouteDescriptor, RouteSchema } from "@mcp-auto-expose/core";
import { MCP_EXPOSE_SYMBOL } from "./mcpExpose.js";
import type { AutoExposeOptions } from "./autoExpose.js";
import { warn } from "./warn.js";

function getRootStack(app: Express): ExpressLayer[] {
  const a = app as unknown as {
    router?: { stack: ExpressLayer[] };
    _router?: { stack: ExpressLayer[] };
    lazyrouter?: () => void;
  };
  if (a.router?.stack) return a.router.stack; // Express 5: public lazy getter
  if (typeof a.lazyrouter === "function") a.lazyrouter(); // Express 4: force lazy init
  if (a._router?.stack) return a._router.stack; // Express 4: after init
  warn("empty-router", {});
  return [];
}

export function walkRoutes(app: Express, opts: AutoExposeOptions): RouteDescriptor[] {
  const out: RouteDescriptor[] = [];
  const seen = new Set<string>();
  const basePath = opts.basePath ?? "";
  walk(getRootStack(app), basePath, out, seen, opts);
  return out;
}
```

#### Recursion

```ts
function walk(
  stack: ExpressLayer[],
  mountPath: string,
  out: RouteDescriptor[],
  seen: Set<string>,
  opts: AutoExposeOptions,
): void {
  for (const layer of stack) {
    if (layer.route) {
      // Terminal: route registered directly in this layer
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];

      for (const p of paths) {
        const url = joinPath(mountPath, p);
        const verbs = methodsOf(layer.route.methods, url);

        for (const verb of verbs) {
          const key = `${verb} ${url}`;
          if (seen.has(key)) {
            warn("duplicate", { verb, url });
            continue;
          }
          seen.add(key);

          const schema = extractSchema(layer.route.stack);

          if (opts.strictSchema !== false && !schema) {
            // strictSchema default: true (different from Fastify)
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

      const childMount = recoverMountPath(layer, mountPath);
      walk(subStack, joinPath(mountPath, childMount), out, seen, opts);
    }
    // Any other middleware (body-parser, cors, etc.) → ignore
  }
}
```

#### Sub-routines

```ts
// Collapses double slashes, preserves :param and Express wildcards verbatim.
// Does not add trailing slash (except when result is exactly "/").
function joinPath(parent: string, child: string): string {
  const raw = `${parent}/${child}`.replace(/\/+/g, "/");
  return raw.length > 1 ? raw.replace(/\/$/, "") : raw;
}

// Extracts HTTP verbs from the methods map. Filters _all and verbs outside HTTPMethod union.
function methodsOf(methods: Record<string, boolean>, url: string): HTTPMethod[] {
  const VALID: ReadonlySet<string> = new Set([
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
  ]);
  return Object.keys(methods)
    .filter((m) => methods[m] && m !== "_all")
    .map((m) => m.toUpperCase())
    .filter((m): m is HTTPMethod => {
      if (VALID.has(m)) return true;
      warn("unknown-method", { verb: m, url });
      return false;
    });
}

// Recovers the mount prefix from a router-type layer.
// Express 5: layer.path; Express 4: regex parsing (canonical pattern).
function recoverMountPath(layer: ExpressLayer, parentMount: string): string {
  if (layer.path && typeof layer.path === "string") return layer.path; // Express 5

  const regexp = layer.regexp;
  if (!regexp) return "";
  if (regexp.fast_slash) return ""; // mounted at "/"

  // Canonical pattern (express-list-endpoints):
  const match = /^\^\\\/(?:\(\?:\(\[\^\\\/]\+\?\)\))?(.*?)\\\/\?\(\?=\\\/\|\$\)/i.exec(
    regexp.source,
  );
  if (match?.[1]) {
    return `/${match[1].replace(/\\\//g, "/")}`;
  }

  warn("regex-parse-failed", { source: regexp.source, parentMount });
  return ""; // graceful degradation: descendants surface under parent mountPath
}

// Finds the first middleware tagged with MCP_EXPOSE_SYMBOL in the route stack.
const SCHEMA_KEY = MCP_EXPOSE_SYMBOL;

function extractSchema(routeStack: Array<{ handle: unknown }>): RouteSchema | undefined {
  let found: RouteSchema | undefined;
  let extra = 0;

  for (const sub of routeStack) {
    const h = sub.handle;
    if (typeof h !== "function") continue;
    const schema = (h as Record<symbol, RouteSchema>)[SCHEMA_KEY];
    if (!schema) continue;
    if (!found) {
      found = schema;
    } else {
      extra++;
    }
  }

  if (extra > 0) {
    warn("multiple-mcpExpose", { count: extra + 1, hint: "first one is used" });
  }
  return found;
}
```

**HEAD policy**: Express (4 and 5) does **not** auto-generate HEAD for GET routes (Fastify does, which is why it filters HEAD in `adaptRouteOptions.ts:8-10`). The Express adapter includes HEAD if the user registers it explicitly. Only filters `_all`.

**Deduplication**: the walker marks `seen` by `METHOD url` and emits a `duplicate` warning. `ToolRegistry` in core maintains its `_2/_3` suffix only for **tool name** collisions (different URLs that produce the same snake_case — safety net, not the primary dedup mechanism).

### 3.5. `autoExpose` factory

```ts
// packages/express/src/autoExpose.ts
import type { Express } from "express";
import type { MCPTool } from "@mcp-auto-expose/core";
import { ToolRegistry, resolveTool } from "@mcp-auto-expose/core";
import { walkRoutes } from "./walkRoutes.js";

export interface AutoExposeOptions {
  strictSchema?: boolean; // default: true (see §3.1)
  eager?: boolean; // default: false
  basePath?: string;
}

export interface AutoExposeHandle {
  tools(): MCPTool[];
  refresh(): MCPTool[];
}

export function autoExpose(app: Express, options: AutoExposeOptions = {}): AutoExposeHandle {
  const opts: AutoExposeOptions = { strictSchema: true, eager: false, ...options };

  let cache: MCPTool[] | undefined;

  function buildCatalog(): MCPTool[] {
    const registry = new ToolRegistry();
    const descriptors = walkRoutes(app, opts);
    for (const descriptor of descriptors) {
      registry.register(resolveTool(descriptor));
    }
    return registry.list();
  }

  if (opts.eager) {
    cache = buildCatalog();
  }

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
```

**Timing and memoization:**

- `eager: false` (default): lazy walk on first call to `tools()`, memoized. There is no `app.ready()` in Express; the natural marker is the user calling `tools()` just before `startStdio`.
- `eager: true`: walk in `autoExpose()` to detect configuration problems at bootstrap.
- `refresh()`: for tests and hot-reload scenarios where routes are added after the first call.

### 3.6. Observability helper — `warn.ts`

```ts
// packages/express/src/warn.ts
const PREFIX = "[mcp-auto-expose:express]";

export function warn(code: string, ctx: Record<string, unknown>): void {
  const line = `${PREFIX} ${code} ${JSON.stringify(ctx)}\n`;
  process.stderr.write(line);
}
```

**Warning catalog:**

| Code                     | Trigger                                                 | Emitted context           |
| ------------------------ | ------------------------------------------------------- | ------------------------- |
| `missing-schema-strict`  | `strictSchema:true` and route without `mcpExpose` tag   | `{ verb, url }`           |
| `regex-parse-failed`     | Express 4: mount regex does not match canonical pattern | `{ source, parentMount }` |
| `unknown-method`         | Verb outside `HTTPMethod` union (e.g., `PROPFIND`)      | `{ verb, url }`           |
| `multiple-mcpExpose`     | More than one tagged middleware on the same route       | `{ count, hint }`         |
| `duplicate`              | Same `METHOD url` produced twice during walk            | `{ verb, url }`           |
| `malformed-router-layer` | `layer.name === "router"` without `handle.stack`        | `{ mountPath }`           |
| `empty-router`           | Empty root stack (app with no routes)                   | `{}`                      |
| `zod-convert-failed`     | `zodToJsonSchema` throws an exception                   | `{ message }`             |
| `schema-has-ref`         | `zodToJsonSchema` output contains `$ref`                | `{ hint }`                |

All warnings have the unique prefix `[mcp-auto-expose:express]` for fast grep in production.

### 3.7. Express 4 vs 5 compatibility matrix

| Feature                  | Express 4                                 | Express 5                              | Adapter strategy                                       |
| ------------------------ | ----------------------------------------- | -------------------------------------- | ------------------------------------------------------ |
| Router access            | `app._router` (undefined until first use) | `app.router` public lazy getter        | `app.router` → `lazyrouter?.()` → `app._router` → `[]` |
| Lazy router init         | `app.lazyrouter()` (semi-public)          | Not needed (`app.router` activates it) | Call `lazyrouter` only if `app.router` is absent       |
| Mount path in sub-router | only `layer.regexp`                       | `layer.path` populated                 | Prefer `layer.path`; fallback canonical regex-parsing  |
| HEAD auto-generation     | No                                        | No                                     | Emit HEAD only if explicitly registered                |
| Wildcard                 | `'/users/*'` (unnamed)                    | `'/users/*splat'` (name required)      | Passthrough verbatim                                   |
| Optional segments        | `:id?`                                    | `'{/:id}'` brace syntax                | Passthrough verbatim                                   |
| `app.all(...)`           | `methods._all === true` + verbs           | Same                                   | Filter `_all` in `methodsOf`                           |
| Array of paths           | `app.get(['/a', '/b'], ...)`              | Same                                   | `Array.isArray(layer.route.path)`                      |
| Native schema            | None                                      | None                                   | `mcpExpose` injected by user                           |

`peerDependencies: { "express": "^4 || ^5" }`. The test suite validates with Express 5 in devDependencies. Express 4 fallback paths are verified with mocked stacks (see §6, Task 4).

## 4. File structure

```
packages/express/
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── README.md
└── src/
    ├── index.ts              # barrel: autoExpose, mcpExpose, types, MCP_EXPOSE_SYMBOL
    ├── autoExpose.ts         # factory + AutoExposeHandle (lazy + memoized + refresh)
    ├── autoExpose.test.ts    # integration with real Express (v5)
    ├── mcpExpose.ts          # mcpExpose, MCP_EXPOSE_SYMBOL, specToRouteSchema
    ├── mcpExpose.test.ts
    ├── walkRoutes.ts         # recursive walker + internal helpers
    ├── walkRoutes.test.ts    # unit tests with mocked stacks
    ├── zodConvert.ts         # convertCached + WeakMap cache
    ├── zodConvert.test.ts
    └── warn.ts               # single stderr logging helper

apps/dev-sandbox/
└── src/
    └── express-main.ts       # NEW — Express smoke (does not touch Fastify main.ts)
```

## 5. `packages/express/package.json`

```json
{
  "name": "@mcp-auto-expose/express",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -b",
    "check-types": "tsc --noEmit",
    "lint": "eslint . --max-warnings 0",
    "test": "node --import tsx --test src/*.test.ts"
  },
  "peerDependencies": {
    "express": "^4 || ^5",
    "zod": "^3 || ^4"
  },
  "dependencies": {
    "@mcp-auto-expose/core": "workspace:*",
    "zod-to-json-schema": "^3.25.2"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/express": "^5.0.0",
    "@types/node": "^22.15.3",
    "eslint": "^9.39.1",
    "express": "^5.0.0",
    "tsx": "^4.19.2",
    "typescript": "5.9.2",
    "zod": "^4.0.0"
  }
}
```

**Note on the `test` script**: uses `src/*.test.ts` (flat glob, maxdepth 1) instead of the command substitution used in `packages/fastify`, for better portability. Adjust if incompatibility is detected with the Node version in CI.

## 6. Task plan (TDD required: red → green → commit)

> Each task follows: red tests → implementation → green tests → commit. Logs always to `stderr`.

### Task 1 — Scaffold `packages/express`

- 1.1. Create `package.json`, `tsconfig.json`, `eslint.config.mjs`, empty `src/index.ts`.
  - `tsconfig.json`: extend `@repo/typescript-config/base.json`, `outDir: "dist"`, `rootDir: "src"`.
  - `eslint.config.mjs`: `import { config } from "@repo/eslint-config/base"; export default config;`
- 1.2. `pnpm install` → resolves `express`, `@types/express`, `zod`, `zod-to-json-schema` as direct deps; updates lockfile.
- 1.3. `pnpm --filter @mcp-auto-expose/express check-types` green.
- 1.4. Commit: `chore(express): scaffold @mcp-auto-expose/express package`.

### Task 2 — `zodConvert` + `warn`

- 2.1. Create `src/warn.ts` (no unit test required — trivial `process.stderr.write`).
- 2.2. Red tests (`zodConvert.test.ts`):
  - `z.object({ id: z.string() })` → produces `{ type: "object", properties: { id: { type: "string" } }, required: ["id"] }` (verify property subset).
  - `z.string()` → produces `{ type: "string" }`.
  - Same `z.object` instance used twice → second call returns the same object (cache hit) — verify with `Object.is`.
  - `specToRouteSchema({ query: z.string() })` → `.querystring` populated, `.body` undefined.
  - `specToRouteSchema({ tags: ["t1"] })` → `.tags` is a copy (`!Object.is`).
- 2.3. Implement `zodConvert.ts` with `convertCached` and `specToRouteSchema`.
- 2.4. Green + commit: `feat(express): zod-to-json-schema Draft 7 converter with WeakMap cache`.

### Task 3 — `mcpExpose` middleware

- 3.1. Red tests (`mcpExpose.test.ts`):
  - The value returned by `mcpExpose({})` is a function.
  - Calling the middleware invokes `next()` once.
  - `(mcpExpose({}) as any)[MCP_EXPOSE_SYMBOL]` returns an object (not undefined).
  - `mcpExpose({ query: z.string() })[MCP_EXPOSE_SYMBOL].querystring` is populated.
  - `mcpExpose({ hide: true })[MCP_EXPOSE_SYMBOL].hide === true`.
  - `mcpExpose({ tags: ["t1"] })[MCP_EXPOSE_SYMBOL].tags` is a defensive copy.
  - Compile-only: `app.get(path, mcpExpose({}), handler)` type-checks without cast.
- 3.2. Implement `mcpExpose.ts`.
- 3.3. Green + commit: `feat(express): mcpExpose decorator middleware (pure metadata carrier)`.

### Task 4 — `walkRoutes` and helpers

- 4.1. Red tests (`walkRoutes.test.ts`) building manual Express stacks (no HTTP server):
  - Simple terminal route: `[{ route: { path: "/api/users", methods: { get: true }, stack: [] } }]` → 1 descriptor `GET /api/users`.
  - Mounted sub-router (Express 5): layer with `name: "router"`, `path: "/api"`, `handle.stack` with route `/users` → descriptor `GET /api/users`.
  - Mounted sub-router (Express 4 fallback): layer without `path`, with matchable `regexp.source` → mount `/api` recovered.
  - `methods._all === true` alongside verbs → `_all` filtered, verbs emitted.
  - Verb `PROPFIND` → warning `unknown-method`, descriptor omitted.
  - Same `GET /api/users` twice → warning `duplicate`, second one omitted.
  - `extractSchema`: route with one tagged middleware → `RouteSchema` returned.
  - `extractSchema`: route with two tagged middlewares → warning `multiple-mcpExpose`, first returned.
  - `extractSchema`: no tagged middleware → `undefined`.
  - `opts.strictSchema: true` + undefined schema → warning `missing-schema-strict`, descriptor omitted.
  - `opts.strictSchema: false` + undefined schema → descriptor emitted.
  - `hide: true` in RouteSchema → descriptor omitted silently.
  - Array of paths: `route.path = ["/a", "/b"]` → 2 descriptors.
  - `basePath: "/api"` → stripped from initial mountPath.
- 4.2. Implement `walkRoutes.ts` with all internal helpers.
- 4.3. Green + commit: `feat(express): recursive route walker with Express 4/5 compat`.

### Task 5 — `autoExpose` factory (integration with real Express)

- 5.1. Red tests (`autoExpose.test.ts`) with real Express **v5**, no HTTP server:
  - App with 3 CRUD routes via Router + `mcpExpose`, `strictSchema:true` → `tools()` returns exactly 3 `MCPTool` with names `list_users`, `get_users_by_id`, `create_users`.
  - `get_users_by_id.inputSchema.properties.id.type === "string"`, `required: ["id"]`.
  - `create_users.inputSchema.properties.name` and `.email` present, `required: ["name", "email"]`.
  - Second call to `tools()` returns the same object (memoized, `Object.is` true).
  - `refresh()` returns new object with same content.
  - `eager: true` → walk occurs in `autoExpose()` (verifiable with spy on `walkRoutes`).
  - `strictSchema: true` + 1 route without `mcpExpose` → that route does not appear in `tools()`.
  - `mcpExpose({ hide: true })` → route omitted from `tools()`.
  - `_source.framework === "express"` on each tool.
- 5.2. Implement `autoExpose.ts`.
- 5.3. Barrel `src/index.ts` with all public exports.
- 5.4. `pnpm --filter @mcp-auto-expose/express check-types` green.
- 5.5. Green + commit: `feat(express): autoExpose factory with lazy memoized walk`.

### Task 6 — Smoke in `apps/dev-sandbox`

- 6.1. Create `apps/dev-sandbox/src/express-main.ts` (see snippet in §3.1). No `console.log`.
- 6.2. Add to `apps/dev-sandbox/package.json`:
  - Script: `"dev:express": "node --import tsx src/express-main.ts"`.
  - Deps: `express: "^5.0.0"`, `zod: "^4.0.0"`, `@mcp-auto-expose/express: "workspace:*"`.
- 6.3. `pnpm install` + `pnpm --filter dev-sandbox check-types` green.
- 6.4. **Manual verification** — initialize and list tools:
  ```sh
  printf '%s\n%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | pnpm --filter dev-sandbox run dev:express 2>express-sandbox.stderr.log
  ```
  **Expected stdout:** exactly 2 JSON-RPC lines — `initialize` response and `tools/list` response with 3 tools (`list_users`, `get_users_by_id`, `create_users`). No other lines.
  **Expected stderr** (`express-sandbox.stderr.log`): adapter diagnostic logs. Does not contaminate stdout.
  **Guard test:** add `console.log("noise")` before `startStdio` → stdout remains pure JSON-RPC.
  **strictSchema test:** comment out `mcpExpose` on a route → `tools/list` drops to 2 tools and stderr shows `missing-schema-strict`.
- 6.5. Commit: `chore(dev-sandbox): add Express smoke entry-point`.

### Task 7 — README for `packages/express`

- 7.1. Full usage snippet: Express + Router + `mcpExpose` + `autoExpose` + `startStdio`.
- 7.2. Section **strictSchema default diverges from Fastify**: security rationale.
- 7.3. Note on `process.stdout.write` — do not use directly (reserved for stdio JSON-RPC).
- 7.4. Express 4 vs 5 compatibility table (summarized, ref §3.7).
- 7.5. Zod edge cases section (`z.discriminatedUnion`, `z.lazy`): what to expect.
- 7.6. Commit: `docs(express): usage, safety constraints, and Express 4/5 compat notes`.

### Task 8 — CI/turbo and global lint

- 8.1. Verify that `tsc -b` produces `dist/` and that `turbo.json` covers `dist/**` in `build.outputs` (already verified: yes — no change required).
- 8.2. `pnpm --filter @mcp-auto-expose/express lint` green (0 warnings).
- 8.3. Global `pnpm lint` green.
- 8.4. `pnpm --filter @mcp-auto-expose/express test` green.
- 8.5. Commit: `chore(turbo): add @mcp-auto-expose/express to workspace` (if adjustments are needed; otherwise omit).

## 7. Acceptance verification

### 7.1. Automated

```sh
pnpm install
pnpm --filter @mcp-auto-expose/express check-types
pnpm --filter @mcp-auto-expose/express test
pnpm --filter dev-sandbox check-types
pnpm lint
```

All green, zero ESLint warnings.

### 7.2. Manual (stdio smoke + Express)

See Task 6.4. Success criteria:

- `tools/list` emits 3 tools with correct names and schemas.
- stdout = pure JSON-RPC; stderr = adapter logs.
- Remove a `mcpExpose` → warning in stderr, tool disappears from catalog.
- `console.log("noise")` → redirected to stderr by the stdio guard.

## 8. Notes and explicit decisions

- **`strictSchema: true` by default**: intentionally diverges from Fastify (`false`). Rationale: Express is prevalent in legacy apps with internal/admin endpoints; explicit opt-in prevents accidental exposure to the LLM. Documented in README.
- **Pure `mcpExpose` (runtime no-op)**: HTTP validation is not this package's responsibility in MVP. Future backwards-compatible extension: `{ validate: true }`.
- **First-wins on multiple `mcpExpose`**: matches Express "first wins" semantics. Warning to stderr to locate the bug.
- **No changes to `@mcp-auto-expose/core`**: `RouteDescriptor.framework: "express"` already supported; `RouteSchema` already covers all fields; `resolveTool` and `ToolRegistry` reused without modification.
- **UTF-8 without BOM** in all files.
- **TypeScript strict**: `noUncheckedIndexedAccess` inherited from `@repo/typescript-config/base.json`; not relaxed.
- **Logs**: all diagnostics via `warn(code, ctx)` with prefix `[mcp-auto-expose:express]`; written to `process.stderr`.
- **`zod-to-json-schema`**: `$refStrategy: "none"` + `target: "jsonSchema7"` + no `name` — rationale in §3.3.
- **Timing**: `autoExpose(app)` after all routes are registered, before `startStdio`. Lazy walk (default) or eager per `options.eager`.

---

**Checkpoint:** Phase 3 specification complete. Please review the Express design document and give your approval to begin implementation.
