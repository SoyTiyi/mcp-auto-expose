# Phase 4 — Streamable HTTP Transport and Authentication

> **Status:** Approved — implementation in progress.
> **Methodology:** Spec-Driven Development (SDD).
> **Principal document anchor:** `docs/principal-document.txt` L77–L118 (Streamable HTTP, SEP-2243, DNS rebinding defenses) and L192–L202 (Phase 5 of product roadmap).
> **Approved predecessors:** Phase 1 (Fastify), Phase 2 (stdio), Phase 3 (Express).

---

## Context

Phase 3 delivered Express and Fastify adapters that extract `MCPTool[]` in memory without mounting any endpoint. The only existing MCP output today goes through stdio (`@mcp-auto-expose/stdio`), suitable for local hosts (Claude Desktop, Cursor) but unable to support remote multi-client deployments.

Phase 4 closes the principal document roadmap by enabling **Streamable HTTP transport** over `StreamableHTTPServerTransport` from SDK `@modelcontextprotocol/sdk` 1.29.0, in literal compliance with:

- **Single HTTP endpoint** serving POST (JSON-RPC) and GET (SSE) on the same path (`docs/principal-document.txt:81-83`).
- **SEP-2243**: `Mcp-Method` and `Mcp-Name` headers mandatory and consistent with the JSON-RPC body; unconditional rejection if they diverge (`:88-91, :202`).
- **DNS rebinding defenses**: `Origin` validation with whitelist and `403` on mismatch; bind to `127.0.0.1` (user-documented responsibility) (`:116-117`).
- **Authentication delegated to modern scaffolding**: Bearer/API keys/OAuth 2.0 (`:118`). Our architectural decision: the adapter does NOT validate tokens; it delegates to the host framework's native middlewares (Passport, Fastify auth plugins, etc.).

Expected result: the user can switch from stdio to Streamable HTTP by changing a single output package, keeping the same `MCPTool[]` array and the same `onToolCall` callback.

---

## 1. Objective

Build a framework-agnostic `@mcp-auto-expose/http` package that mounts a single MCP Streamable HTTP endpoint in a Node host application, plus two idiomatic sub-binders (`/express`, `/fastify`). The package:

1. Reuses `StreamableHTTPServerTransport` from SDK 1.29.0.
2. Validates SEP-2243 headers before handing control to the SDK.
3. Applies a configurable `Origin` whitelist.
4. Supports the **`x-mcp-header`** extension defined in SEP-2243 Final for parameters transported as `Mcp-Param-{Name}`.
5. Does **not** implement authentication; documents the delegation pattern.
6. Maintains catalog parity with stdio (same `MCPTool`, same `onToolCall`).

---

## 2. Architecture

### 2.1 New package

`packages/http` — `@mcp-auto-expose/http`.

Exports three entry points:

| Subpath                         | Purpose                                                         |
| ------------------------------- | --------------------------------------------------------------- |
| `@mcp-auto-expose/http`         | Framework-agnostic factory `createMcpHttp` + shared types.      |
| `@mcp-auto-expose/http/express` | Binder `mountMcpExpress` (returns `RequestHandler` + `Router`). |
| `@mcp-auto-expose/http/fastify` | Binder `mcpFastifyPlugin` (FastifyPluginAsync).                 |

### 2.2 Changes in existing packages

- `packages/core`: no structural changes to `MCPTool`. Invocation remains "out-of-band" via `onToolCall` callback (same contract as stdio).
- `packages/express`: adds helper `mcpHeader(zodSchema)` and modifies `zodConvert.ts` to preserve the `"x-mcp-header": true` annotation in the produced JSON Schema.
- `packages/fastify`: adds symmetric `mcpHeader(zodSchema)` helper and replicates annotation preservation in `adaptRouteOptions.ts`.
- `packages/stdio`: no changes. Continues dispatching via callback. Its contract `(tool, args) => result` is a subset of HTTP `(tool, args, ctx) => result` — the same callback works on both transports.

### 2.3 Architectural decisions confirmed with user

| Decision                       | Outcome                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Endpoint**                   | Single path (default `/mcp`, configurable) serving POST + GET + DELETE. Aligns with `docs/principal-document.txt:81` ("a single endpoint"). |
| **Location**                   | New package `@mcp-auto-expose/http` with sub-binders. Preserves Phase 3 invariant.                                                          |
| **`x-mcp-header` declaration** | Zod helper `mcpHeader(z.string())` that stamps the annotation into the JSON Schema.                                                         |

### 2.4 Additional technical decisions

- **Dispatch**: explicit callback `onToolCall(tool, args, ctx)`. Virtual re-invocation of Express/Fastify routes is out of scope (optional future Phase 4.1).
- **Sessions**: stateless by default (`sessionIdGenerator: undefined`), stateful opt-in via `options.session: "stateful"`.
- **Auth**: delegated to the host framework. The adapter propagates `req.auth` (if present) to `ctx.auth`.
- **Origin defense**: integrated middleware. Default `allowedOrigins: []` allows requests **without** Origin (CLI clients, server-to-server) with warning to stderr; rejects with `403` any present Origin that does not match the whitelist.
- **Localhost bind**: not enforced by the adapter (it is `app.listen()` responsibility). The adapter emits a warning to stderr if it detects `HOST=0.0.0.0` or `BIND_ADDRESS=0.0.0.0` in env. Documented in README.

---

## 3. Detailed technical design

### 3.1 Public API — `packages/http/src/index.ts`

```ts
import type { Server } from "@modelcontextprotocol/sdk/server";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { MCPTool } from "@mcp-auto-expose/core";

export interface McpHttpContext {
  /** Raw headers (lowercase keys). */
  headers: Record<string, string | string[] | undefined>;
  /** AuthInfo propagated from req.auth by previous middlewares. */
  auth?: unknown;
  /** SEP-2243 projected subset. */
  mcp: { method: string; name: string };
  /** Args extracted from Mcp-Param-* (see §3.4). */
  headerParams: Record<string, string>;
}

export type OnToolCallHttp = (
  tool: MCPTool,
  args: unknown,
  ctx: McpHttpContext,
) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;

export interface McpHttpOptions {
  /** Default "/mcp". */
  path?: string;
  /** Origin whitelist. Default []: requires Origin absent or explicit opt-in. */
  allowedOrigins?: string[];
  /** Default "stateless". */
  session?: "stateful" | "stateless";
  /** Default randomUUID if session=stateful. */
  sessionIdGenerator?: () => string;
  /** Default false: SDK responds with SSE. true ⇒ pure JSON. */
  enableJsonResponse?: boolean;
  /** Default true: warning to stderr if bind=0.0.0.0. */
  warnOnNonLocalhost?: boolean;
  tools: MCPTool[];
  name: string;
  version: string;
  onToolCall: OnToolCallHttp;
  /** Controlled injection for tests. */
  _deps?: { server?: Server; transport?: StreamableHTTPServerTransport };
}

export interface McpHttpHandle {
  handleNodeRequest(
    req: import("node:http").IncomingMessage & { auth?: unknown; body?: unknown },
    res: import("node:http").ServerResponse,
  ): Promise<void>;
  close(): Promise<void>;
}

export function createMcpHttp(options: McpHttpOptions): McpHttpHandle;
```

### 3.2 Express binder — `packages/http/src/express.ts`

```ts
import type { RequestHandler, Router } from "express";
import type { McpHttpOptions } from "./index.js";

export interface MountMcpExpressResult {
  middleware: RequestHandler; // app.all('/mcp', mw)
  router: Router; // app.use(router); pre-mounts path
  close(): Promise<void>;
}

export function mountMcpExpress(opts: McpHttpOptions): MountMcpExpressResult;
```

### 3.3 Fastify binder — `packages/http/src/fastify.ts`

```ts
import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";
import type { McpHttpOptions } from "./index.js";

export type McpFastifyPluginOptions = McpHttpOptions & FastifyPluginOptions;
export const mcpFastifyPlugin: FastifyPluginAsync<McpFastifyPluginOptions>;
```

### 3.4 `x-mcp-header` pipeline (defined in SEP-2243 Final)

#### 3.4.1 User declaration

```ts
import { z } from "zod";
import { mcpHeader, mcpExpose } from "@mcp-auto-expose/express";

const schema = z.object({
  tenant_id: mcpHeader(z.string().describe("Tenant id from auth context")),
  invoice_id: z.string(),
});

router.post(
  "/invoices",
  mcpExpose({
    name: "create_invoice",
    description: "Create an invoice for the tenant",
    inputSchema: schema,
  }),
  handler,
);
```

#### 3.4.2 Zod → JSON Schema conversion

`mcpHeader<T extends ZodTypeAny>(zod: T): T` stamps a marker `__mcpHeader = true` on the Zod schema (via internal `WeakSet` to avoid mutation). The converter in `packages/express/src/zodConvert.ts` detects the marker and produces:

```json
{
  "type": "object",
  "properties": {
    "tenant_id": {
      "type": "string",
      "description": "Tenant id from auth context",
      "x-mcp-header": true
    },
    "invoice_id": { "type": "string" }
  },
  "required": ["tenant_id", "invoice_id"]
}
```

The property **remains visible to the LLM** (it can pass it as a normal argument). The annotation informs the HTTP adapter which params can also be collected from headers.

#### 3.4.3 Verbatim header naming

The value of the `x-mcp-header` field is used **verbatim** as the HTTP header segment — without kebabization or additional transformation.

- `"x-mcp-header": "TenantId"` ⇄ `Mcp-Param-TenantId`
- `"x-mcp-header": "Region"` ⇄ `Mcp-Param-Region`

Value constraints (SEP-2243 §"Custom Headers from Tool Parameters"):

- Non-empty.
- ASCII only (excluding space and `:`).
- Case-insensitively unique among all `x-mcp-header` values in the same `inputSchema`.
- Only applicable to primitive-type properties (`string`, `number`, `boolean`).

#### 3.4.4 Body ↔ header merge policy

| Case        | body.args         | header | resulting args    | Side effect                           |
| ----------- | ----------------- | ------ | ----------------- | ------------------------------------- |
| Body only   | `{tenant_id:"a"}` | absent | `{tenant_id:"a"}` | —                                     |
| Header only | `{}`              | `"a"`  | `{tenant_id:"a"}` | `ctx.headerParams.tenant_id="a"`      |
| Match       | `{tenant_id:"a"}` | `"a"`  | `{tenant_id:"a"}` | —                                     |
| Mismatch    | `{tenant_id:"a"}` | `"b"`  | `{tenant_id:"b"}` | warn `header-body-mismatch` to stderr |

"Header wins" because the spec positions headers as the edge routing layer; a proxy/gateway may have injected them authoritatively. Documented in README.

#### 3.4.5 Base64 sentinel encoding for values not representable as plain ASCII

The client encodes the parameter value as standard Base64 (RFC 4648 §4, with `=` padding) wrapped in the sentinel `=?base64?<value>?=` when the serialized string:

- starts or ends with space (0x20) or tab (0x09),
- contains any character outside 0x20-0x7E (non-ASCII), or
- contains control chars (0x00-0x1F or 0x7F).

The server decodes the sentinel before comparing against the body. Decode failure ⇒ error `-32001` (`HeaderMismatch`).

### 3.5 SEP-2243 validation — `packages/http/src/sep2243.ts`

```ts
export interface Sep2243Outcome {
  ok: boolean;
  reason?: "missing-header" | "method-mismatch" | "name-mismatch" | "malformed-body";
  mcp?: { method: string; name: string };
}

export function validateSep2243(
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
): Sep2243Outcome;
```

Rules (derived from `docs/principal-document.txt:88-91` and `:202`):

- POST with JSON-RPC body requires `Mcp-Method` present. Absence ⇒ `missing-header` ⇒ `400`.
- If `method === "tools/call"`, also requires `Mcp-Name` matching `body.params.name`.
- `body.method !== headers["mcp-method"]` ⇒ `method-mismatch` ⇒ `400`.
- GET (SSE opening) does not require `Mcp-Name`.
- `initialize`, `tools/list`, `ping`: `Mcp-Name` optional (header can be empty or absent; if present, no coherence validation because there is no name target).
- DELETE (stateful session close): headers optional.

**Execution order:** BEFORE the SDK transport. SDK 1.29 does not validate header↔body coherence.

### 3.6 Origin defense — `packages/http/src/origin.ts`

```ts
export function checkOrigin(
  originHeader: string | undefined,
  allowedOrigins: string[],
): { ok: true } | { ok: false; status: 403; reason: string };
```

- `originHeader` absent ⇒ `ok: true` + warning once per minute if `allowedOrigins.length === 0`.
- `originHeader` present:
  - If `allowedOrigins.length === 0` ⇒ `403` (the spec requires verification; without a whitelist we cannot approve).
  - If exact case-insensitive match ⇒ `ok: true`.
  - If no match ⇒ `403` with `{"error":"forbidden"}` (no additional information to the attacker).

### 3.7 Dispatch bridge — `packages/http/src/createMcpHttp.ts`

Factory steps in order:

1. Validate options (`path` starts with `/`, `allowedOrigins` is array, `name`/`version` non-empty).
2. `localhostWarn(warnOnNonLocalhost)` reads env and emits warning if applicable.
3. Create `AsyncLocalStorage<McpHttpContext>` (`httpContextStorage`).
4. Instantiate `new Server({ name, version }, { capabilities: { tools: {} } })`.
5. Call `registerTools({ server, tools, onToolCall: bridge })` where `bridge(tool, args)` reads `httpContextStorage.getStore()`, merges `headerParams` into `args` (policy §3.4.4) and delegates to `userOnToolCall(tool, enrichedArgs, ctx)`.
6. Instantiate `new StreamableHTTPServerTransport({ sessionIdGenerator: session === "stateful" ? (sessionIdGenerator ?? randomUUID) : undefined, enableJsonResponse })`.
7. `await server.connect(transport)`.
8. Return `{ handleNodeRequest, close }`.

`handleNodeRequest(req, res)`:

1. `originGuard` → if it fails, `res.writeHead(403).end(...)` and return.
2. Parse body (Express/Fastify binders ensure `req.body` is already parsed JSON).
3. `validateSep2243(req.headers, req.body)` → if it fails, `400` with `{ "error": "<reason>" }`.
4. Build `ctx`: normalized headers (lowercase), `auth: req.auth`, `mcp: { method, name }`, `headerParams` extracted by `parseHeaderParams(req.headers, toolByName(headers["mcp-name"]))`.
5. `httpContextStorage.run(ctx, () => transport.handleRequest(req, res, req.body))`.

### 3.8 Transport parity matrix

| Capability                 | stdio | Streamable HTTP                                 |
| -------------------------- | ----- | ----------------------------------------------- |
| Tool catalog (`MCPTool[]`) | ✅    | ✅ identical                                    |
| `onToolCall(tool, args)`   | ✅    | ✅ + 3rd arg `ctx` (optional, backwards-compat) |
| `Mcp-Param-*` headers      | N/A   | ✅                                              |
| Auth context (`ctx.auth`)  | N/A   | ✅ delegated to framework                       |
| Sessions                   | N/A   | ✅ stateless default, stateful opt-in           |

---

## 4. File structure

```
packages/http/
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── README.md
└── src/
    ├── index.ts                  # barrel + createMcpHttp
    ├── createMcpHttp.ts          # framework-agnostic factory
    ├── createMcpHttp.test.ts
    ├── sep2243.ts                # validateSep2243 (pure)
    ├── sep2243.test.ts
    ├── origin.ts                 # checkOrigin (pure)
    ├── origin.test.ts
    ├── headerParams.ts           # kebabize / parseHeaderParams / mergeArgs
    ├── headerParams.test.ts
    ├── localhostWarn.ts          # 0.0.0.0 detection
    ├── express.ts                # mountMcpExpress
    ├── express.test.ts           # supertest + real express
    ├── fastify.ts                # mcpFastifyPlugin
    ├── fastify.test.ts           # fastify.inject()
    └── warn.ts                   # stderr logger prefix [mcp-auto-expose:http]

packages/express/src/
├── mcpHeader.ts                  # NEW: mcpHeader() helper (stamp marker)
└── zodConvert.ts                 # MOD: preserve x-mcp-header in JSON Schema

packages/fastify/src/
├── mcpHeader.ts                  # NEW: symmetric to express
└── adaptRouteOptions.ts          # MOD: preserve x-mcp-header

apps/dev-sandbox/src/
├── http-express-main.ts          # NEW: Streamable HTTP + Express smoke
├── http-fastify-main.ts          # NEW: Streamable HTTP + Fastify smoke
└── http-client-smoke.ts          # NEW: SDK MCP client against either
```

---

## 5. `packages/http/package.json`

```jsonc
{
  "name": "@mcp-auto-expose/http",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./express": { "import": "./dist/express.js", "types": "./dist/express.d.ts" },
    "./fastify": { "import": "./dist/fastify.js", "types": "./dist/fastify.d.ts" },
  },
  "scripts": {
    "build": "tsc -b",
    "check-types": "tsc -b --noEmit",
    "test": "vitest run",
    "lint": "eslint . --max-warnings 0",
  },
  "dependencies": {
    "@mcp-auto-expose/core": "workspace:*",
  },
  "peerDependencies": {
    "@modelcontextprotocol/sdk": "~1.29.0",
    "express": "^4.0.0 || ^5.0.0",
    "fastify": "^5.0.0",
  },
  "peerDependenciesMeta": {
    "express": { "optional": true },
    "fastify": { "optional": true },
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "*",
    "express": "^5.1.0",
    "fastify": "^5.0.0",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0",
  },
}
```

---

## 6. Task plan (TDD: red → green → commit)

> Logs to `stderr` always with prefix `[mcp-auto-expose:http]`. UTF-8 without BOM. Zero `console.log`.

### Task 1 — Scaffold `packages/http`

- 1.1. `package.json`, `tsconfig.json`, `eslint.config.mjs`, empty barrel.
- 1.2. Add to `pnpm-workspace.yaml` if needed and refresh `pnpm install`.
- 1.3. `pnpm --filter @mcp-auto-expose/http check-types` green.
- 1.4. Commit: `chore(http): scaffold @mcp-auto-expose/http`.

### Task 2 — `origin.ts`

- 2.1. Red tests (matrix: absent, present match, present no-match, empty whitelist).
- 2.2. Implementation.
- 2.3. Commit: `feat(http): origin whitelist guard`.

### Task 3 — `sep2243.ts`

- 3.1. Red tests: missing header, method mismatch, name mismatch (in tools/call), GET without Mcp-Name accepted, `tools/list` without Mcp-Name accepted, malformed body, `initialize`.
- 3.2. Implementation.
- 3.3. Commit: `feat(http): SEP-2243 header coherence validator`.

### Task 4 — `headerParams.ts`

- 4.1. Red tests:
  - `kebabize("tenant_id") === "Tenant-Id"`.
  - `kebabize("invoice_external_ref") === "Invoice-External-Ref"`.
  - `parseHeaderParams` extracts only props with `x-mcp-header: true` from the schema.
  - `mergeArgs` applies policy §3.4.4 (header wins on mismatch + warn).
- 4.2. Implementation.
- 4.3. Commit: `feat(http): Mcp-Param-* header param pipeline`.

### Task 5 — `mcpHeader()` in `packages/express` and `packages/fastify`

- 5.1. Red tests in `packages/express/src/zodConvert.test.ts`:
  - `mcpHeader(z.string())` produces JSON Schema with `"x-mcp-header": true`.
  - When combined with `.describe(...)` both coexist.
- 5.2. Same set of tests for `packages/fastify`.
- 5.3. Implement `mcpHeader.ts` (each package with its own WeakSet, both generate `x-mcp-header: true`).
- 5.4. Modify converters to detect marker and stamp annotation.
- 5.5. Commit: `feat(zod): mcpHeader() annotation for header-borne params`.

### Task 6 — `createMcpHttp.ts`

- 6.1. Red tests (with `_deps` to inject in-memory transport):
  - `tools/list` round-trip returns the provided tools.
  - `tools/call` invokes `onToolCall` with correct args.
  - `ctx.mcp.method === "tools/call"`, `ctx.mcp.name === <tool>` when callback fires.
  - `ctx.headerParams.tenant_id` populated when `Mcp-Param-Tenant-Id` is sent.
  - `ctx.auth` propagates `req.auth`.
  - `close()` closes transport and server.
- 6.2. Implementation with AsyncLocalStorage.
- 6.3. Commit: `feat(http): createMcpHttp factory with Streamable transport`.

### Task 7 — `mountMcpExpress`

- 7.1. Red tests (supertest + real Express):
  - `POST /mcp` with `initialize` body returns 200 + `protocolVersion`.
  - `POST /mcp` with `Mcp-Method: tools/list` returns catalog.
  - `POST /mcp` with header/body mismatch → 400.
  - `POST /mcp` with `Origin` not in whitelist → 403.
  - `GET /mcp` with `Accept: text/event-stream` opens SSE.
  - Previous middleware setting `req.auth = {sub:"u1"}` propagates to `ctx.auth`.
  - `Mcp-Param-Tenant-Id` is injected into handler args.
- 7.2. Implementation: Router with `.post`, `.get`, `.delete` on `path`.
- 7.3. Commit: `feat(http): Express binder for Streamable HTTP`.

### Task 8 — `mcpFastifyPlugin`

- 8.1. Red tests (fastify.inject):
  - Same cases as Task 7.
  - Own `addContentTypeParser` on path `/mcp` to avoid clashing with Fastify's default parser.
  - Optional `disableRequestLogging` respected.
- 8.2. Implementation.
- 8.3. Commit: `feat(http): Fastify binder for Streamable HTTP`.

### Task 9 — Express smoke in `apps/dev-sandbox`

- 9.1. `http-express-main.ts`: Express + Router + `mcpExpose` (4 tools, including one with `mcpHeader` for `tenant_id`).
- 9.2. `autoExpose` extracts `tools`; `mountMcpExpress({tools, onToolCall, allowedOrigins:["http://localhost:5173"]})`.
- 9.3. `app.listen(3000, "127.0.0.1")`.
- 9.4. Commit: `chore(dev-sandbox): HTTP Express smoke entry-point`.

### Task 10 — Fastify smoke

- 10.1. `http-fastify-main.ts` analogous.
- 10.2. Commit: `chore(dev-sandbox): HTTP Fastify smoke entry-point`.

### Task 11 — MCP SDK end-to-end client

- 11.1. `http-client-smoke.ts`: `StreamableHTTPClientTransport` pointing to `127.0.0.1:3000/mcp`, executes `listTools()` + `callTool()`.
- 11.2. Verifies catalog parity against stdio.
- 11.3. Commit: `chore(dev-sandbox): MCP SDK client smoke for HTTP transport`.

### Task 12 — README for `packages/http`

- 12.1. Express usage pattern with prior auth middleware.
- 12.2. Equivalent Fastify pattern with `preHandler`.
- 12.3. **Security** section: Origin, bind to `127.0.0.1`, delegated auth.
- 12.4. **SEP-2243** section: curl examples with correct and incorrect headers.
- 12.5. **`x-mcp-header` extension** section declared as part of the MCP standard (not a project-specific extension).
- 12.6. Commit: `docs(http): usage, security, SEP-2243 reference`.

### Task 13 — CI / global lint

- 13.1. `pnpm lint`, `pnpm test`, `pnpm build` green at root.
- 13.2. Adjust `turbo.json` if new envs/inputs need to be declared.
- 13.3. Commit: `chore(ci): wire @mcp-auto-expose/http into turbo pipeline`.

---

## 7. Acceptance verification

### 7.1 Automated

```sh
pnpm install
pnpm --filter @mcp-auto-expose/http check-types
pnpm --filter @mcp-auto-expose/http test
pnpm --filter @mcp-auto-expose/express test    # includes new mcpHeader tests
pnpm --filter @mcp-auto-expose/fastify test    # same
pnpm --filter dev-sandbox check-types
pnpm lint
pnpm build
```

Criterion: all green, zero ESLint warnings.

### 7.2 Manual with curl (Express sandbox running on 127.0.0.1:3000)

```sh
# 1. initialize
curl -sN -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Method: initialize" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'

# 2. tools/list
curl -sN -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Method: tools/list" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 3. tools/call with Mcp-Param-*
curl -sN -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Method: tools/call" -H "Mcp-Name: create_invoice" -H "Mcp-Param-Tenant-Id: t1" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_invoice","arguments":{"invoice_id":"inv-001"}}}'

# 4. Header/body mismatch → 400
curl -sN -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -H "Mcp-Method: tools/list" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call"}'

# 5. Rejected Origin → 403
curl -sN -X POST http://127.0.0.1:3000/mcp \
  -H "Origin: https://evil.example" -H "Content-Type: application/json" \
  -H "Mcp-Method: tools/list" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/list"}'

# 6. SSE GET
curl -sN -X GET http://127.0.0.1:3000/mcp -H "Accept: text/event-stream"
```

### 7.3 Manual with SDK MCP client

`pnpm --filter dev-sandbox tsx src/http-client-smoke.ts` ⇒ prints catalog and result of successful `callTool`. The catalog must be **identical** to that obtained via stdio in `apps/dev-sandbox/src/main.ts`.

### 7.4 Fastify smoke

`pnpm --filter dev-sandbox tsx src/http-fastify-main.ts` ⇒ exhibits cross-framework parity.

---

## 8. Notes and explicit decisions

1. **`x-mcp-header` extension** is defined in SEP-2243 Final (https://modelcontextprotocol.io/seps/2243-http-standardization) — it is not a project-specific extension. The README must declare it as part of the MCP standard.

2. **Auth delegated to the framework** is NOT explicitly mandated by `docs/principal-document.txt`. The doc authorizes Bearer/OAuth but does not require framework delegation. The decision is justified by: (a) the adapter must not duplicate mature ecosystems (Passport, JWT, Fastify auth); (b) keeping the adapter framework-agnostic at the transport layer; (c) SDK 1.29 already supports `AuthInfo` propagated via `req.auth`.

3. **Bind to `127.0.0.1`** is not enforced by the adapter — it is `app.listen()`. Warning to stderr + documentation.

4. **Stateless by default** aligns with `docs/principal-document.txt:92-97` (SEP-2549). Stateful is opt-in.

5. **Virtual re-invocation of Express/Fastify routes** is out of scope — optional future Phase 4.1.

6. **SDK version pin**: `~1.29.0` in `peerDependencies` during MVP.

7. **SSE tests**: use `testTimeout: 5000` in Vitest to avoid hangs.

8. **Encoding**: all files UTF-8 without BOM.
