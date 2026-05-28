# Phase 1 — Auto-Discovery Engine (Fastify Adapter)

> **Status:** Specification pending human approval. Methodology: Spec-Driven Development.
> **Anchor:** `docs/principal-document.txt` §27–§45, §170–§176.
> **Date:** 2026-05-22.

## 1. Objective

Build the TypeScript module that hooks into the Fastify lifecycle, intercepts each route definition at registration time, extracts its JSON Schemas and deterministically translates them to the Model Context Protocol `Tool` contract. The module keeps an in-memory **tool registry** that later phases (3 and 5) will consume and inject into the MCP server.

**Out of scope for Phase 1:**

- Dispatching LLM invocations to the actual Fastify handler (Phase 3+).
- MCP stdio server (Phase 3).
- Express adapter (Phase 4).
- MCP Streamable HTTP server, SEP-2243, SEP-2549, SEP-414 (Phase 5).

## 2. Architecture

```
+-------------------+      onRoute       +-------------------+
| Host application  | -----------------> | autoExpose plugin |
| (Fastify v5)      |  routeOptions      | (packages/fastify)|
+-------------------+                    +---------+---------+
                                                   |
                                                   v
                                         +-------------------+
                                         | Mismatch Resolver |
                                         | (packages/core)   |
                                         +---------+---------+
                                                   |
                                                   v   MCPTool
                                         +-------------------+
                                         | ToolRegistry      |
                                         | (packages/core)   |
                                         +-------------------+
```

### 2.1. Packages to create

- `packages/core` → `@mcp-auto-expose/core`
  - Public types: `MCPTool`, `MCPToolInputSchema`, `RouteDescriptor`, `HTTPMethod`.
  - Pure functions: `resolveTool(descriptor): MCPTool`, `generateToolName(method, url)`, `flattenSchema(routeSchema)`.
  - `ToolRegistry`: `register(tool)`, `list(): MCPTool[]`, `clear()`. Collision detection with log to `stderr`.
- `packages/fastify` → `@mcp-auto-expose/fastify`
  - Fastify plugin (wrapped with `fastify-plugin`): `autoExpose(options?)`.
  - Hooks `addHook('onRoute')` globally and delegates to `core`.
  - Decorates the instance with `mcpAutoExpose.tools()` for inspection.

Both packages: strict TypeScript (`@repo/typescript-config/base.json`), `"type": "module"`, `"private": true` until a release phase.

## 3. Detailed technical design

### 3.1. Interception with `addHook('onRoute')`

Expected usage:

```ts
import Fastify from "fastify";
import { autoExpose } from "@mcp-auto-expose/fastify";

const app = Fastify();
await app.register(autoExpose, { strictSchema: false });
// …define routes…
await app.ready();
const tools = app.mcpAutoExpose.tools(); // MCPTool[]
```

Internally:

```ts
fastify.addHook("onRoute", (routeOptions) => {
  for (const descriptor of adaptRouteOptions(routeOptions, options)) {
    const tool = resolveTool(descriptor);
    registry.register(tool);
  }
});
```

`routeOptions` (Fastify v5 `RouteOptions`) provides:

- `method`: `HTTPMethods | HTTPMethods[]`.
- `url`: string with `:id` or `{id}` parameters.
- `schema?`: `{ body?, querystring?, params?, response?, headers? }` with JSON Schema.
- `schema.description?`, `schema.summary?`, `schema.tags?`, `schema.hide?`.
- `config?`, `prefix?`, `version?`.

**Deterministic rules:**

1. If `method` is an array, one tool is emitted **per method**.
2. The `url` already has `prefix` applied: used as-is.
3. If `schema.hide === true` (Swagger/OpenAPI convention), the route is skipped.
4. If `config?.mcpExpose === false`, the route is skipped (declarative escape hatch).
5. If `options.strictSchema === true` and the route has no `schema.body/querystring/params`, the route is skipped.

**Note on HEAD and OPTIONS in the Fastify adapter**: Fastify v5 auto-generates a HEAD route for every registered GET route. The adapter automatically filters HEAD to avoid duplicate tools. OPTIONS is included as a supported method since users may define OPTIONS handlers with their own semantics.

### 3.2. Tool name generation (`generateToolName`)

Deterministic, aligned with the common CRUD pattern:

| HTTP Method  | Pattern                         | Input                   | Output                |
| ------------ | ------------------------------- | ----------------------- | --------------------- |
| GET (list)   | `list_{resource}`               | `GET /api/users`        | `list_users`          |
| GET (item)   | `get_{resource}_by_{param}`     | `GET /api/users/:id`    | `get_users_by_id`     |
| POST         | `create_{resource}`             | `POST /api/users`       | `create_users`        |
| PUT          | `replace_{resource}_by_{param}` | `PUT /api/users/:id`    | `replace_users_by_id` |
| PATCH        | `update_{resource}_by_{param}`  | `PATCH /api/users/:id`  | `update_users_by_id`  |
| DELETE       | `delete_{resource}_by_{param}`  | `DELETE /api/users/:id` | `delete_users_by_id`  |
| HEAD/OPTIONS | `{method_lower}_{resource}`     | `OPTIONS /api/users`    | `options_users`       |

**Algorithm:**

1. Tokenize `url` by `/`, discarding empty segments.
2. Classify segments as `static` and `param` (`:id` or `{id}`).
3. `resource = last static segment` (snake_case, plural preserved).
4. `params = parameter names without `:` or `{}``.
5. Build the name according to the table. If there is >1 param, concatenate with `_and_`.
6. If the name exceeds 64 characters, truncate and append `_h<hash6>` (deterministic hash of the full path).
7. If there is a collision in the `ToolRegistry`, append suffix `_2`, `_3`, …; log to `stderr`.

### 3.3. Schema flattening (`flattenSchema`)

`MCPTool.inputSchema` must be **a single JSON Schema object with `type: "object"`** that groups `params`, `querystring` and `body`:

```ts
function flattenSchema(routeSchema?: FastifyRouteSchema): MCPToolInputSchema {
  const out: MCPToolInputSchema = { type: "object", properties: {}, required: [] };
  if (!routeSchema) return out;

  for (const source of ["params", "querystring", "body"] as const) {
    const sub = routeSchema[source];
    if (!sub) continue;
    if (sub.type !== "object") {
      // body can be primitive or array: wrap it under the source key
      out.properties[source] = sub;
      continue;
    }
    for (const [key, propSchema] of Object.entries(sub.properties ?? {})) {
      const finalKey = renameOnCollision(key, source, out.properties);
      out.properties[finalKey] = propSchema;
      if ((sub.required ?? []).includes(key)) out.required.push(finalKey);
    }
  }
  if (out.required.length === 0) delete out.required;
  return out;
}
```

**Key anti-collision**: if the same name appears in two sources (rare, e.g. `id` in params and body), the second one gets a `<source>_<key>` prefix. Logged to `stderr`.

**`$ref` / definitions**: in MVP, cross-references are not resolved. If a sub-branch includes an unresolvable `$ref`, a warning is logged and the property is omitted. (Resolution via `ajv` is future work.)

### 3.4. Tool description

```
description = routeSchema?.description
           ?? routeSchema?.summary
           ?? `${METHOD} ${url} — auto-discovered by mcp-auto-expose`
```

### 3.5. `MCPTool` contract (in `@mcp-auto-expose/core`)

Compatible with `Tool` from `@modelcontextprotocol/sdk`:

```ts
export type HTTPMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface MCPToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: MCPToolInputSchema;
  // Non-MCP metadata — internal use only, not serialized to the client:
  _source: {
    framework: "fastify" | "express";
    method: HTTPMethod;
    url: string;
  };
}
```

`_source` is preserved for Phase 3 (HTTP call reconstruction in the invoker).

## 4. File structure

```
packages/
├── core/
│   ├── package.json
│   ├── tsconfig.json
│   ├── eslint.config.mjs
│   └── src/
│       ├── index.ts             # public exports barrel
│       ├── types.ts             # MCPTool, MCPToolInputSchema, RouteDescriptor, HTTPMethod
│       ├── resolveTool.ts       # Main resolver
│       ├── toolName.ts          # generateToolName
│       ├── flattenSchema.ts     # flattenSchema + renameOnCollision
│       └── registry.ts          # ToolRegistry
└── fastify/
    ├── package.json
    ├── tsconfig.json
    ├── eslint.config.mjs
    └── src/
        ├── index.ts             # barrel
        ├── plugin.ts            # autoExpose plugin (fastify-plugin)
        └── adaptRouteOptions.ts # Fastify routeOptions → RouteDescriptor[]
```

### 4.1. `packages/core/package.json` (skeleton)

```json
{
  "name": "@mcp-auto-expose/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -b",
    "check-types": "tsc --noEmit",
    "lint": "eslint . --max-warnings 0",
    "test": "node --test --import tsx 'src/**/*.test.ts'"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^22.15.3",
    "eslint": "^9.39.1",
    "tsx": "^4.19.2",
    "typescript": "5.9.2"
  }
}
```

### 4.2. `packages/fastify/package.json` (skeleton)

```json
{
  "name": "@mcp-auto-expose/fastify",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -b",
    "check-types": "tsc --noEmit",
    "lint": "eslint . --max-warnings 0",
    "test": "node --test --import tsx 'src/**/*.test.ts'"
  },
  "peerDependencies": { "fastify": "^5.0.0" },
  "dependencies": {
    "@mcp-auto-expose/core": "workspace:*",
    "fastify-plugin": "^5.0.0"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^22.15.3",
    "eslint": "^9.39.1",
    "fastify": "^5.0.0",
    "tsx": "^4.19.2",
    "typescript": "5.9.2"
  }
}
```

`turbo.json` will receive a `test` task and `build` `outputs` will be adjusted to include `dist/**`.

## 5. Task plan (numbered, TDD required)

> Each task follows red → green → commit. Logs to `stderr` always.

### Task 1 — Scaffold `packages/core`

- 1.1. Create `packages/core/package.json`, `tsconfig.json`, `eslint.config.mjs`, empty `src/index.ts`.
- 1.2. `pnpm install`; verify `pnpm --filter @mcp-auto-expose/core check-types`.
- 1.3. Commit: `chore(core): scaffold @mcp-auto-expose/core package`.

### Task 2 — Public types in `core`

- 2.1. Red test: `src/types.test.ts` (type-level assertions on the shape of `MCPTool`).
- 2.2. Implement `src/types.ts` with `MCPTool`, `MCPToolInputSchema`, `RouteDescriptor`, `HTTPMethod`.
- 2.3. Green + commit: `feat(core): public types for MCP tool contract`.

### Task 3 — `generateToolName`

- 3.1. Red tests in `src/toolName.test.ts` covering the §3.2 table, truncation at 64 chars, and collision.
- 3.2. Implement `src/toolName.ts`.
- 3.3. Green + commit: `feat(core): deterministic tool name generator`.

### Task 4 — `flattenSchema`

- 4.1. Red tests: absent schema, `params` + `body`, key collision, primitive body (wrapped), unresolvable `$ref` (warn + skip).
- 4.2. Implement `src/flattenSchema.ts` with `renameOnCollision` helper.
- 4.3. Green + commit: `feat(core): flatten Fastify schemas to flat MCP inputSchema`.

### Task 5 — `ToolRegistry`

- 5.1. Red tests: duplicate `register` (suffix + stderr log), ordered `list`, `clear`.
- 5.2. Implement `src/registry.ts`.
- 5.3. Green + commit: `feat(core): tool registry with collision logging to stderr`.

### Task 6 — `resolveTool` (composition)

- 6.1. Red tests: `RouteDescriptor` → `MCPTool` end-to-end (with/without schema, multi-method, hide).
- 6.2. Implement `src/resolveTool.ts` integrating Tasks 3 + 4 + §3.4.
- 6.3. Green + commit: `feat(core): resolveTool orchestrator (Impedance Mismatch Resolver)`.

### Task 7 — Scaffold `packages/fastify`

- 7.1. Create `packages/fastify/package.json`, `tsconfig.json`, `eslint.config.mjs`, empty `src/index.ts`.
- 7.2. `pnpm install`; verify check-types.
- 7.3. Commit: `chore(fastify): scaffold @mcp-auto-expose/fastify package`.

### Task 8 — `adaptRouteOptions`

- 8.1. Red tests: `RouteOptions` with `method: string[]` → multiple `RouteDescriptor`s; `schema.hide` → skip; `config.mcpExpose === false` → skip.
- 8.2. Implement `src/adaptRouteOptions.ts`.
- 8.3. Green + commit: `feat(fastify): adapt routeOptions to RouteDescriptor`.

### Task 9 — `autoExpose` plugin

- 9.1. Red integration test: Fastify + plugin + 3 CRUD routes with schema; `await app.ready()` → snapshot of `app.mcpAutoExpose.tools()`.
- 9.2. Implement `src/plugin.ts` (wrapped with `fastify-plugin`; decorates the instance; hooks `onRoute`).
- 9.3. Red test: route without schema → tool with `inputSchema: {type:"object",properties:{}}`. Green.
- 9.4. Red test: `strictSchema: true` → route without schema is NOT registered. Green.
- 9.5. Commit: `feat(fastify): autoExpose plugin with onRoute hook integration`.

### Task 10 — Usage documentation and end-to-end verification

- 10.1. Minimal README in each package with usage snippet.
- 10.2. `pnpm --filter @mcp-auto-expose/fastify test` must pass.
- 10.3. Commit: `docs: usage snippets for fastify adapter and core`.

## 6. Acceptance verification

After completing the 10 tasks, this smoke test must run and emit 3 coherent tools:

```ts
// scripts/smoke-fase1.ts
import Fastify from "fastify";
import { autoExpose } from "@mcp-auto-expose/fastify";

const app = Fastify();
await app.register(autoExpose);

app.get("/api/users", { schema: { description: "List users" } }, async () => []);
app.get(
  "/api/users/:id",
  {
    schema: {
      description: "Get user by id",
      params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    },
  },
  async () => ({}),
);
app.post(
  "/api/users",
  {
    schema: {
      description: "Create user",
      body: {
        type: "object",
        properties: { name: { type: "string" }, email: { type: "string" } },
        required: ["name", "email"],
      },
    },
  },
  async () => ({}),
);

await app.ready();
process.stderr.write(JSON.stringify(app.mcpAutoExpose.tools(), null, 2));
```

Expected output:

- 3 tools: `list_users`, `get_users_by_id`, `create_users`.
- `get_users_by_id.inputSchema.properties.id.type === "string"`, `required: ["id"]`.
- `create_users.inputSchema.properties.{name,email}`, `required: ["name","email"]`.
- All diagnostic output travels via `stderr`.

Verification commands:

```sh
pnpm install
pnpm --filter @mcp-auto-expose/core check-types
pnpm --filter @mcp-auto-expose/core test
pnpm --filter @mcp-auto-expose/fastify check-types
pnpm --filter @mcp-auto-expose/fastify test
pnpm lint
node --import tsx scripts/smoke-fase1.ts 2>tools.json
```

## 7. Notes and explicit decisions

- **Logs**: defensive `console.warn`/`console.log` from the adapter always go to `stderr` (`console.error` or `process.stderr.write`).
- **UTF-8**: files without BOM.
- **TypeScript strict**: `noUncheckedIndexedAccess` inherited, not relaxed.
- **Out of Phase 1**: invoking tools, stdio/HTTP transport, OAuth, W3C Trace Context observability, `ttlMs` cache, Express adapter, SEP-2243/2549/414.

---

**Checkpoint**: once this document is approved, Tasks 1–10 will be executed sequentially.
