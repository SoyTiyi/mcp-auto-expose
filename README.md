# mcp-auto-expose

Automatically exposes REST API endpoints (Fastify / Express) as MCP tools.
Zero manual configuration: the library introspects the framework router and registers tools in an MCP server, ready to be consumed by LLM agents.

Protocol: **MCP 2025-11-25** | SEPs: **2243** (required) · **2549** (optional cache) · **414** (W3C Trace Context)

---

## How it works

The library never replaces your REST API — it **mirrors** it as an MCP tool catalog and routes
each agent call back to your real endpoint.

```
Your API (Express / Fastify)
        │  discover
        ▼
  Framework adapter        fastify: onRoute hook · express: walks app._router.stack
        │  emits
        ▼
  RouteDescriptor          { framework, method, url, schema }   ← neutral format
        │  resolveTool()   (core)
        ▼
  MCPTool                  name + description + inputSchema (+ hidden source metadata)
        │  ToolRegistry     (name de-duplication)
        ▼
  MCPTool[]  ──►  transport  ──►  MCP SDK  ──►  tool call  ──►  fetch your backend
               (stdio | HTTP)                                  (or run in-process)
```

The **core** engine is framework-agnostic: adapters translate their world into a neutral
`RouteDescriptor`, and `resolveTool()` turns that into a tool. Tool names are **deterministic**:

| Route                   | Tool name            |
| ----------------------- | -------------------- |
| `GET /api/users`        | `list_users`         |
| `GET /api/users/:id`    | `get_users_by_id`    |
| `POST /api/users`       | `create_users`       |
| `DELETE /api/users/:id` | `delete_users_by_id` |

> **Opt-in vs opt-out:** Fastify exposes every schema'd route (opt out per route with
> `config: { mcpExpose: false }`). Express is opt-in by design — only routes decorated with
> `mcpExpose()` are exposed, so internal/admin endpoints are never published by accident.

---

## Installation

```sh
# Fastify + stdio (local, no network)
pnpm add @mcp-auto-expose/fastify @mcp-auto-expose/stdio

# Express + Streamable HTTP
pnpm add @mcp-auto-expose/express @mcp-auto-expose/http
```

---

## Quickstart — Fastify + stdio

```ts
import Fastify from "fastify";
import { autoExpose } from "@mcp-auto-expose/fastify";
import { startStdio } from "@mcp-auto-expose/stdio";

const app = Fastify({ logger: { stream: process.stderr } });
await app.register(autoExpose);

app.get("/api/users", async () => [{ id: "u1", name: "Ana" }]);

app.post(
  "/api/users",
  {
    schema: {
      body: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
  },
  async (req) => ({ id: "u2", ...(req.body as object) }),
);

await app.listen({ port: 3000, host: "127.0.0.1" });

// Expose tools via MCP stdio for local agents
const tools = app.mcpAutoExpose.tools();
await startStdio({ name: "my-server", version: "1.0.0", tools });
```

---

## Quickstart — Express + Streamable HTTP

```ts
import express, { Router } from "express";
import { autoExpose, mcpExpose } from "@mcp-auto-expose/express";
import { mountMcpExpress } from "@mcp-auto-expose/http/express";

const app = express();
app.use(express.json());
const handle = autoExpose(app);

const router = Router();
router.get("/users", mcpExpose({ description: "List users" }), (_req, res) => {
  res.json([{ id: "u1", name: "Ana" }]);
});
app.use("/api", router);

const { router: mcpRouter } = mountMcpExpress({
  name: "my-server",
  version: "1.0.0",
  tools: handle.tools(),
  allowedOrigins: [],
  apiBaseUrl: "http://127.0.0.1:3000",
});
app.use(mcpRouter);

app.listen(3000, "127.0.0.1");
// MCP endpoint available at http://127.0.0.1:3000/mcp
```

---

## Packages

| Package                    | Description                                                                  |
| -------------------------- | ---------------------------------------------------------------------------- |
| `@mcp-auto-expose/core`    | Auto-discovery engine: `generateToolName`, `flattenSchema`, `makeHttpCaller` |
| `@mcp-auto-expose/fastify` | Fastify plugin with `onRoute` hook                                           |
| `@mcp-auto-expose/express` | Recursive `app._router.stack` walker + `mcpExpose` / `mcpHeader` decorators  |
| `@mcp-auto-expose/stdio`   | stdio transport with `stdoutGuard` (redirects `console.*` → stderr)          |
| `@mcp-auto-expose/http`    | Streamable HTTP (POST+SSE); binders for Express and Fastify                  |

---

## Header parameters (`x-mcp-header`, SEP-2243)

Mark a parameter so it travels as an `Mcp-Param-*` HTTP header instead of in the request body —
handy for tenant ids, tokens, or any value you want kept out of the tool arguments. The library
enforces coherence: if the body and the header disagree, the call is rejected with HTTP 400.

```ts
// Express (Zod)
import { mcpExpose, mcpHeader } from "@mcp-auto-expose/express";
import { z } from "zod";

router.get(
  "/users/:id",
  mcpExpose({
    params: z.object({ id: z.string(), tenant_id: mcpHeader(z.string(), "TenantId") }),
  }),
  handler,
); // tenant_id is carried as `Mcp-Param-TenantId`

// Fastify (plain JSON Schema)
import { mcpHeader } from "@mcp-auto-expose/fastify";
// params: { type: "object", properties: { tenant_id: mcpHeader({ type: "string" }, "TenantId") } }
```

---

## Escape hatch — `defineTool`

Not every tool maps to an HTTP route. Use `defineTool` to add a tool that runs **in-process**
(no HTTP roundtrip), validated with a Zod schema:

```ts
import { defineTool } from "@mcp-auto-expose/core";
import { z } from "zod";

const ping = defineTool({
  name: "ping",
  description: "Returns pong",
  inputSchema: z.object({}),
  execute: async () => ({ content: [{ type: "text", text: "pong" }] }),
});

// pass it alongside discovered tools, e.g. startStdio({ name, version, tools: [...handle.tools(), ping] })
```

---

## Status

| Feature                                      | Status                                    |
| -------------------------------------------- | ----------------------------------------- |
| MCP Protocol                                 | `2025-11-25`                              |
| SEP-2243 required headers                    | Implemented (default on)                  |
| SEP-2549 cache hints (`ttlMs`, `cacheScope`) | Implemented (opt-in via `toolsListCache`) |
| SEP-414 W3C Trace Context → backend          | Implemented                               |
| Real backend route invocation                | Implemented (`makeHttpCaller`)            |

---

## Development

```sh
pnpm dev                         # all packages in watch mode
pnpm build                       # compile everything
pnpm test                        # tests for all packages
pnpm lint                        # lint with ESLint
pnpm check-types                 # type-check with tsc

# Integration smoke test:
node --import tsx apps/dev-sandbox/src/http-express-main.ts &
node --import tsx apps/dev-sandbox/src/http-client-smoke.ts
```

---

## Sponsors

Does your company depend on `mcp-auto-expose`? Consider sponsoring the project
to ensure its continued maintenance and development.

[![GitHub Sponsors](https://img.shields.io/badge/GitHub%20Sponsors-❤-ea4aaa?logo=github)](https://github.com/sponsors/SoyTiyi)
[![Polar.sh](https://img.shields.io/badge/Polar.sh-Sponsor-blue?logo=polar)](https://polar.sh/mcp-auto-expose)

---

MIT License — see [LICENSE](LICENSE)
