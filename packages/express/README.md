# @mcp-auto-expose/express

Introspects an Express.js app's registered routes and exposes them as MCP (Model Context Protocol) tools for LLMs.

## Installation

```sh
pnpm add @mcp-auto-expose/express
# npm install @mcp-auto-expose/express
# yarn add @mcp-auto-expose/express
```

Peer dependencies — install separately if not already present:

```sh
pnpm add express zod
```

`express` `^4 || ^5` and `zod` `^3 || ^4` are supported as peer dependencies.

## Quick start

```ts
import express, { Router } from "express";
import { z } from "zod/v3"; // must be "zod/v3" — see Zod compatibility note below
import { autoExpose, mcpExpose } from "@mcp-auto-expose/express";
import { startStdio } from "@mcp-auto-expose/stdio";

const app = express();
const router = Router();

router.get(
  "/users",
  mcpExpose({
    description: "List all users",
    query: z.object({ limit: z.string().optional() }),
  }),
  (_req, res) => res.json([]),
);

router.get(
  "/users/:id",
  mcpExpose({
    description: "Get a user by ID",
    params: z.object({ id: z.string() }),
  }),
  (_req, res) => res.json({}),
);

router.post(
  "/users",
  mcpExpose({
    description: "Create a new user",
    body: z.object({ name: z.string(), email: z.string().email() }),
  }),
  (_req, res) => res.status(201).json({}),
);

app.use("/api", router);

// Do NOT call app.listen() before autoExpose — routes must be registered first.
const handle = autoExpose(app);

await startStdio({
  name: "my-express-server",
  version: "1.0.0",
  tools: handle.tools(),
});
```

The process blocks listening on `stdin`/`stdout` for the JSON-RPC 2.0 MCP protocol.

## API reference

### `autoExpose(app, options?): AutoExposeHandle`

Introspects all routes registered on an Express app (or sub-router) and returns a handle to the discovered MCP tool catalog.

```ts
import { autoExpose } from "@mcp-auto-expose/express";

const handle = autoExpose(app, { strictSchema: true });
```

Route walking is **lazy by default** — it happens on the first `handle.tools()` call, after all routes have been registered. Do not call `handle.tools()` before all routes are attached to the app.

#### `AutoExposeOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `strictSchema` | `boolean` | `true` | When `true`, only routes that have an `mcpExpose()` middleware are exposed. When `false`, all routes are exposed regardless. See [strictSchema default](#strictschema-defaults-to-true) for rationale. |
| `eager` | `boolean` | `false` | When `true`, the route walk runs immediately in `autoExpose()` instead of on the first `tools()` call. |
| `basePath` | `string` | `""` | URL prefix to strip from route paths before generating tool names. Useful when the app is mounted at a sub-path in a larger system. |

#### `AutoExposeHandle`

| Method | Returns | Description |
|---|---|---|
| `tools()` | `MCPTool[]` | Lazy walk + memoized result. Safe to call multiple times — the walk runs only once. |
| `refresh()` | `MCPTool[]` | Clears the cache and re-walks all routes. Use after dynamically registering routes post-startup. |

---

### `mcpExpose(spec): RequestHandler`

Returns an Express middleware that attaches MCP schema metadata to a route. It calls `next()` immediately and has **zero request-time cost** — it is a pure metadata carrier, not a validation layer.

```ts
import { mcpExpose } from "@mcp-auto-expose/express";

router.get(
  "/products/:id",
  mcpExpose({
    description: "Fetch a product by ID",
    params: z.object({ id: z.string() }),
    query: z.object({ expand: z.string().optional() }),
  }),
  handler,
);
```

Place `mcpExpose()` before the route handler in the middleware chain. Multiple `mcpExpose()` calls on the same route are allowed but only the first is used; a warning is emitted to `stderr` for the rest.

#### `McpExposeSpec`

| Field | Type | Description |
|---|---|---|
| `body` | `ZodTypeAny` | Schema for `req.body`. |
| `query` | `ZodTypeAny` | Schema for `req.query` (Express idiom). Internally mapped to `RouteSchema.querystring`. |
| `params` | `ZodTypeAny` | Schema for `req.params` (URL path parameters). |
| `description` | `string` | Human-readable description exposed in the MCP tool descriptor. |
| `summary` | `string` | Short one-line summary for the tool. |
| `tags` | `string[]` | Grouping tags for the tool. |
| `hide` | `boolean` | When `true`, silently excludes this route from the tool catalog even if `strictSchema: false`. |

---

## `strictSchema` defaults to `true`

Unlike the Fastify adapter (where `strictSchema` defaults to `false`), the Express adapter defaults to **`strictSchema: true`**.

Express is widely used in legacy codebases that accumulate internal, admin, and debug endpoints over time — routes that should never be callable by an LLM. With `strictSchema: false`, every registered route would be exposed automatically, including routes you may have forgotten about. A misconfigured LLM agent could then invoke sensitive endpoints without any intent from the developer.

By requiring an explicit `mcpExpose()` call, the Express adapter makes exposure an **opt-in decision** at the route level. This prevents accidental leakage of endpoints like `/admin/reset-db` or `/_internal/health-secret`.

**Comparison:**

| Adapter | `strictSchema` default | Rationale |
|---|---|---|
| `@mcp-auto-expose/fastify` | `false` | Fastify routes are typically schema-annotated; discovery is additive |
| `@mcp-auto-expose/express` | `true` | Express apps accumulate undocumented routes; opt-in prevents accidental exposure |

To expose all routes regardless of `mcpExpose()` decoration, pass `strictSchema: false` explicitly:

```ts
const handle = autoExpose(app, { strictSchema: false });
```

---

## Zod compatibility note

Schemas passed to `mcpExpose()` **must** be created with `zod/v3`:

```ts
// Correct
import { z } from "zod/v3";

// Wrong — Zod v4 schemas will silently produce empty {} JSON Schemas
import { z } from "zod";
```

`zod-to-json-schema` uses the Zod v3 internal API for schema introspection. If you pass a Zod v4 schema (imported from bare `"zod"` when Zod v4 is installed), conversion will not error but will produce an empty `{}` schema. The resulting MCP tool will have no input validation metadata.

This applies regardless of your installed Zod version. Always import from `"zod/v3"` in files that define schemas for `mcpExpose()`.

---

## stdout safety note

**Never write to `stdout` in an app that uses the stdio MCP transport.**

`@mcp-auto-expose/stdio` reserves `stdout` exclusively for the JSON-RPC 2.0 protocol stream. Any stray write to stdout — including `console.log`, `process.stdout.write`, or any stream that drains into stdout — will corrupt the MCP protocol and break the LLM connection.

```ts
// Wrong — corrupts the JSON-RPC stream
console.log("Server started");
process.stdout.write("debug info\n");

// Correct — stderr is safe
process.stderr.write("Server started\n");
console.error("debug info");
```

`@mcp-auto-expose/stdio` installs a global guard that redirects `console.*` calls to `stderr` automatically. However, it cannot intercept `process.stdout.write` directly — that would destroy the protocol. Your application code must not write there.

---

## Express 4 vs Express 5 compatibility

The adapter supports both Express 4 and Express 5. Differences are handled internally and transparently.

| Feature | Express 4 | Express 5 |
|---|---|---|
| Router access | `app._router` (private) — requires calling `app.lazyrouter()` first to force initialization | `app.router` (lazy public getter) — no manual init needed |
| Mount path on sub-router layers | Recovered by parsing the layer's compiled regexp (canonical Express 4 pattern) | Available directly as `layer.path` (string) |
| Peer dependency range | `"express": "^4 \|\| ^5"` | Same |

No configuration is needed to select between versions — the adapter detects the available property at runtime.

---

## Zod edge cases

The following table describes how `zod-to-json-schema` (via `convertCached`) handles various Zod schema shapes and what the resulting MCP tool schema looks like.

| Zod schema | JSON Schema output | Notes |
|---|---|---|
| `z.object({ id: z.string() })` | `{ type: "object", properties: { id: { type: "string" } }, required: ["id"] }` | Standard case. Required fields are inferred from Zod's optionality. |
| `z.string()` (primitive body) | `{ type: "string" }` | Valid for `body` or `query` fields. No wrapping is applied. |
| `z.array(z.string())` | `{ type: "array", items: { type: "string" } }` | Arrays are converted inline. |
| `z.discriminatedUnion("type", [...])` | `{ oneOf: [...] }` | Each variant becomes a branch in `oneOf`. Works as long as variants are flat `z.object()` shapes. |
| `z.lazy(() => Node)` (recursive) | `{}` | `$refStrategy: "none"` is used, so recursive schemas cannot be expressed. The walk emits a `schema-has-ref` warning to `stderr` and falls back to `{}`. Use flat schemas instead. |
