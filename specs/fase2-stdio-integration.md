# Phase 2 — stdio Transport + MCP Server Instantiation

> **Status:** Specification approved — awaiting green light for implementation.
> **Methodology:** Spec-Driven Development.
> **Anchor:** `docs/principal-document.txt` §70–§76 (stdio transport), §177–§183 (Phase 3 of roadmap), §35 (impedance mismatch resolver).
> **Date:** 2026-05-23.

## 1. Objective

Connect the output of the Phase 1 Fastify adapter (`app.mcpAutoExpose.tools(): MCPTool[]`) to a real MCP server instance using the local stdio transport. The resulting process exposes the tool catalog via `tools/list` and protects the stdout JSON-RPC pipe from any contamination by host framework logs.

**Out of scope:**

- Real dispatch of `tools/call` to Fastify handlers (requires extending `_source` in core to preserve the flatten→`{params, querystring, body}` mapping). Implemented in a later phase.
- Express adapter (Phase 4).
- Streamable HTTP, SEP-2243, SEP-2549, SEP-414 (Phase 5).

## 2. Architecture

```
apps/dev-sandbox  ── Fastify v5 + autoExpose ──► app.mcpAutoExpose.tools(): MCPTool[]
                                                        │
                                                        ▼
                                          startStdio({ name, version, tools })
                                                        │
                              ┌────────────────────────┴────────────────────────┐
                              │ packages/stdio  (@mcp-auto-expose/stdio)         │
                              │                                                  │
                              │ 1. installStdoutGuard()  ─► console.* → stderr   │
                              │ 2. new McpServer({ name, version })              │
                              │ 3. for each tool: server.registerTool(...)       │
                              │ 4. await server.connect(new StdioServerTransport)│
                              └──────────────────────────────────────────────────┘
                                                        │
                                                        ▼
                                       stdin/stdout = JSON-RPC 2.0 UTF-8
```

### 2.1. Packages to create

- `packages/stdio` → `@mcp-auto-expose/stdio`
  - `stdoutGuard.ts`: global `console.*` → stderr guard.
  - `registerTools.ts`: iterates `MCPTool[]` and calls `server.registerTool(...)`.
  - `startStdio.ts`: public async factory.
- `apps/dev-sandbox` — test app that composes Fastify + `autoExpose` + `startStdio`.

## 3. Detailed technical design

### 3.1. Public API of `@mcp-auto-expose/stdio`

```ts
import type { MCPTool } from "@mcp-auto-expose/core";

export interface StartStdioOptions {
  name: string;
  version: string;
  tools: MCPTool[];
  /** Default true. Disable only in isolated tests. */
  installGuard?: boolean;
  /** Optional hook. Phase 2 default = structured placeholder. */
  onToolCall?: (
    tool: MCPTool,
    args: unknown,
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

export interface StartStdioHandle {
  close(): Promise<void>;
}

export async function startStdio(options: StartStdioOptions): Promise<StartStdioHandle>;
export { installStdoutGuard, restoreStdoutGuard, isStdoutGuardInstalled } from "./stdoutGuard.js";
```

Expected usage (from `apps/dev-sandbox`):

```ts
import Fastify from "fastify";
import { autoExpose } from "@mcp-auto-expose/fastify";
import { startStdio } from "@mcp-auto-expose/stdio";

const app = Fastify({ logger: { stream: process.stderr } });
await app.register(autoExpose);
// … define routes …
await app.ready();
await startStdio({ name: "dev-sandbox", version: "0.0.0", tools: app.mcpAutoExpose.tools() });
```

### 3.2. stdout/stderr guard (`stdoutGuard.ts`)

**Rationale** (principal-document §75, §183): `stdout` is consecrated exclusively to the JSON-RPC protocol. Any stray `console.log` silently destroys the MCP client session.

**Strategy:** globally patch `console` methods; each one serializes via `util.format(...args) + "\n"` and writes to `process.stderr.write`. **Does not** patch `process.stdout.write` because the SDK's `StdioServerTransport` uses it directly and replacing it would destroy the protocol.

Patched methods: `log`, `info`, `warn`, `error`, `debug`, `trace`, `dir`, `group`, `groupCollapsed`, `groupEnd`, `table`, `count`, `countReset`, `time`, `timeLog`, `timeEnd`, `assert`.

**Contractual constraint documented in README**: host code must not call `process.stdout.write` directly. Pino (Fastify v5's default logger) writes to stdout unless configured with `logger: { stream: process.stderr }` — this configuration is required when using the stdio transport.

**Signatures:**

```ts
export function installStdoutGuard(): void; // idempotent
export function restoreStdoutGuard(): void; // restores originalConsole (for tests)
export function isStdoutGuardInstalled(): boolean;
```

### 3.3. Dynamic tool registration (`registerTools.ts`)

The MCP TypeScript SDK v1.x exposes `fromJsonSchema` to use plain JSON Schema (without Zod) as `inputSchema`, which fits exactly with `MCPToolInputSchema` from `@mcp-auto-expose/core`.

```ts
import { fromJsonSchema } from "@modelcontextprotocol/sdk/server/mcp.js";
// (exact import path confirmed after pnpm install per package export map)

export function registerTools({ server, tools, onToolCall }): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema(tool.inputSchema),
      },
      async (args) => {
        if (onToolCall) return await onToolCall(tool, args);
        return {
          content: [
            {
              type: "text",
              text:
                `[phase2-placeholder] tool "${tool.name}" maps to ` +
                `${tool._source.method} ${tool._source.url}. ` +
                `Real invocation pending a later phase.`,
            },
          ],
        };
      },
    );
  }
}
```

### 3.4. `startStdio.ts` factory

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { installStdoutGuard } from "./stdoutGuard.js";
import { registerTools } from "./registerTools.js";

export async function startStdio(options: StartStdioOptions): Promise<StartStdioHandle> {
  if (options.installGuard !== false) installStdoutGuard();

  const server = new McpServer({ name: options.name, version: options.version });
  registerTools({ server, tools: options.tools, onToolCall: options.onToolCall });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return {
    async close() {
      await server.close();
    },
  };
}
```

### 3.5. File structure

```
packages/stdio/
├── package.json
├── tsconfig.json
├── eslint.config.mjs
└── src/
    ├── index.ts
    ├── stdoutGuard.ts
    ├── stdoutGuard.test.ts
    ├── registerTools.ts
    ├── registerTools.test.ts
    └── startStdio.ts

apps/dev-sandbox/
├── package.json
├── tsconfig.json
└── src/
    └── main.ts
```

### 3.6. `packages/stdio/package.json`

```json
{
  "name": "@mcp-auto-expose/stdio",
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
  "dependencies": {
    "@mcp-auto-expose/core": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.0.0"
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

### 3.7. `apps/dev-sandbox/package.json`

```json
{
  "name": "dev-sandbox",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --import tsx src/main.ts",
    "check-types": "tsc --noEmit",
    "lint": "eslint . --max-warnings 0"
  },
  "dependencies": {
    "@mcp-auto-expose/fastify": "workspace:*",
    "@mcp-auto-expose/stdio": "workspace:*",
    "fastify": "^5.0.0"
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

## 4. Task plan (TDD required: red → green → commit)

### Task 1 — Scaffold `packages/stdio`

- 1.1. Create `package.json`, `tsconfig.json`, `eslint.config.mjs`, empty `src/index.ts`.
- 1.2. `pnpm install` (resolves `@modelcontextprotocol/sdk` and adds it to the lockfile).
- 1.3. `pnpm --filter @mcp-auto-expose/stdio check-types`.
- 1.4. Commit: `chore(stdio): scaffold @mcp-auto-expose/stdio package`.

### Task 2 — `stdoutGuard`

- 2.1. Red tests (`stdoutGuard.test.ts`): `console.log("x")` after `installStdoutGuard()` writes nothing to stdout; `restoreStdoutGuard()` restores; `installStdoutGuard()` is idempotent (second call does not duplicate the patching).
- 2.2. Implement `stdoutGuard.ts`.
- 2.3. Green + commit: `feat(stdio): global console guard redirecting to stderr`.

### Task 3 — `registerTools`

- 3.1. Red tests (`registerTools.test.ts`): minimal mock of `McpServer` with spy on `registerTool`; N tools → N calls; each call includes `name`, `description` and `inputSchema`; the placeholder handler includes `_source.method` and `_source.url` in the text.
- 3.2. Implement `registerTools.ts`.
- 3.3. Green + commit: `feat(stdio): dynamic tool registration from MCPTool[]`.

### Task 4 — `startStdio`

- 4.1. Lightweight test with mocks of `McpServer` and `StdioServerTransport`: confirms order `installStdoutGuard` → `new McpServer` → `registerTools` → `connect`.
- 4.2. Implement `startStdio.ts`.
- 4.3. Barrel `src/index.ts` with public exports.
- 4.4. Green + commit: `feat(stdio): startStdio factory wiring McpServer + StdioServerTransport`.

### Task 5 — Scaffold `apps/dev-sandbox`

- 5.1. Create `package.json`, `tsconfig.json`, `src/main.ts`.
- 5.2. `pnpm install`.
- 5.3. `pnpm --filter dev-sandbox check-types` green.
- 5.4. Commit: `chore(dev-sandbox): scaffold sandbox app`.

### Task 6 — End-to-end smoke and documentation

- 6.1. Manual verification (see §5.2).
- 6.2. `apps/dev-sandbox/README.md` with smoke instructions.
- 6.3. Commit: `docs(dev-sandbox): stdio smoke test instructions`.

### Task 7 — README for `packages/stdio`

- 7.1. Usage snippet, Pino/Fastify note, contractual constraint on `process.stdout.write`.
- 7.2. Commit: `docs(stdio): usage and stdio safety notes`.

### Task 8 — CI/turbo

- 8.1. Verify whether `tsc -b` produces `dist/`. If so, add `"outputs": ["dist/**"]` to the `build` task in `turbo.json`.
- 8.2. Global `pnpm lint` with no warnings.
- 8.3. Commit: `chore(turbo): include dist outputs for @mcp-auto-expose/stdio` (if applicable).

## 5. Acceptance verification

### 5.1. Automated

```sh
pnpm install
pnpm --filter @mcp-auto-expose/stdio check-types
pnpm --filter @mcp-auto-expose/stdio test
pnpm --filter dev-sandbox check-types
pnpm lint
```

All green, zero warnings.

### 5.2. Manual (stdio smoke)

```sh
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| pnpm --filter dev-sandbox exec node --import tsx src/main.ts \
  2>sandbox.stderr.log
```

**Expected stdout:** exactly two JSON-RPC lines — the `initialize` response and the `tools/list` response with 3 tools (`list_users`, `get_users_by_id`, `create_users`). No other lines.

**Expected stderr (`sandbox.stderr.log`):** Pino/Fastify logs and any package diagnostics. Does not contaminate stdout.

**Guard test:** insert `console.log("noise")` in `main.ts` before `startStdio`. Verify that stdout remains pure JSON-RPC and `sandbox.stderr.log` contains `"noise"`.

## 6. Notes and explicit decisions

- **`tools/call` placeholder**: in Phase 2 the handler returns descriptive text. The real implementation requires extending `MCPTool._source` in `@mcp-auto-expose/core` with an `originKey → "params"|"querystring"|"body"` map to reconstruct the HTTP request. That is future phase work.
- **No changes to `@mcp-auto-expose/core`** or `@mcp-auto-expose/fastify` in this phase.
- **Logs**: all package runtime diagnostics use `process.stderr.write`.
- **UTF-8**: files without BOM.
- **TypeScript strict**: `noUncheckedIndexedAccess` inherited, not relaxed.
- **`pnpm-workspace.yaml`**: already covers `packages/*` and `apps/*`; no changes required.

---

**Checkpoint**: specification approved. Tasks 1–8 will be executed sequentially upon operator go-ahead.
