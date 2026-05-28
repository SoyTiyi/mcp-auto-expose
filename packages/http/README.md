# @mcp-auto-expose/http

Streamable HTTP transport for [mcp-auto-expose](../../README.md). Mounts a single `/mcp` endpoint that serves MCP JSON-RPC over HTTP POST and SSE (GET) per the [MCP Streamable HTTP spec](https://modelcontextprotocol.io/specification).

## Installation

```sh
pnpm add @mcp-auto-expose/http
```

Peer deps (install whichever framework you use):

```sh
pnpm add express        # for mountMcpExpress
pnpm add fastify        # for mcpFastifyPlugin
```

---

## Express

```ts
import express from "express";
import { mountMcpExpress } from "@mcp-auto-expose/http/express";
import { autoExpose } from "@mcp-auto-expose/express";

const app = express();
app.use(express.json());

// Optional: auth middleware BEFORE MCP (propagates req.auth → ctx.auth)
app.use(passport.authenticate("bearer", { session: false }));

const handle = autoExpose(app, { strictSchema: true });
// ... mount your routes ...

const { router, close } = mountMcpExpress({
  name: "my-api",
  version: "1.0.0",
  tools: handle.tools(),
  allowedOrigins: ["https://app.example.com"], // omit or [] to allow any origin (server-to-server)
  onToolCall: async (tool, args, ctx) => {
    // ctx.auth     → from req.auth (set by auth middleware)
    // ctx.mcp      → { method, name } from Mcp-Method / Mcp-Name headers
    // ctx.headerParams → Mcp-Param-* values
    const result = await dispatchToRoute(tool, args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
});

app.use(router); // mounts POST/GET/DELETE /mcp
app.listen(3000, "127.0.0.1");

process.on("SIGTERM", () => close());
```

---

## Fastify

```ts
import Fastify from "fastify";
import { mcpFastifyPlugin } from "@mcp-auto-expose/http/fastify";
import type { MCPTool } from "@mcp-auto-expose/http";

const fastify = Fastify();

// Optional: auth preHandler sets request.raw.auth before MCP handler
fastify.addHook("preHandler", async (request) => {
  (request.raw as { auth?: unknown }).auth = await validateToken(request.headers.authorization);
});

await fastify.register(mcpFastifyPlugin, {
  name: "my-api",
  version: "1.0.0",
  tools: myTools as MCPTool[],
  allowedOrigins: ["https://app.example.com"],
  onToolCall: async (tool, args, ctx) => {
    return { content: [{ type: "text", text: JSON.stringify(await dispatch(tool, args)) }] };
  },
});

await fastify.listen({ port: 3000, host: "127.0.0.1" });
```

---

## Options

| Option               | Type                        | Default       | Description                                                                                                           |
| -------------------- | --------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------- |
| `path`               | `string`                    | `"/mcp"`      | HTTP path for the MCP endpoint                                                                                        |
| `allowedOrigins`     | `string[]`                  | `[]`          | Allowed `Origin` values. `[]` = no browser clients (server-to-server OK).                                             |
| `session`            | `"stateless" \| "stateful"` | `"stateless"` | Stateless: new transport per request. Stateful: session map keyed by `Mcp-Session-Id`.                                |
| `enableJsonResponse` | `boolean`                   | `false`       | Return JSON instead of SSE. Useful for simple request-response clients.                                               |
| `requireSep2243`     | `boolean`                   | `false`       | Enforce `Mcp-Method` / `Mcp-Name` header coherence (SEP-2243). Enable in browser-facing deployments to mitigate CSRF. |
| `warnOnNonLocalhost` | `boolean`                   | `true`        | Warn to stderr if `HOST` or `BIND_ADDRESS` env is `0.0.0.0`.                                                          |
| `tools`              | `MCPTool[]`                 | required      | Tool catalog (from `autoExpose` or manual).                                                                           |
| `name`               | `string`                    | required      | Server name reported in `initialize`.                                                                                 |
| `version`            | `string`                    | required      | Server version.                                                                                                       |
| `onToolCall`         | `OnToolCallHttp`            | required      | Callback invoked for every `tools/call` request.                                                                      |

---

## Security

### DNS Rebinding / CSRF protection

**Bind to `127.0.0.1`**, not `0.0.0.0`, when serving local tools:

```ts
app.listen(3000, "127.0.0.1"); // Express
fastify.listen({ host: "127.0.0.1" }); // Fastify
```

The adapter emits a stderr warning if it detects `HOST=0.0.0.0` or `BIND_ADDRESS=0.0.0.0` in the environment.

**Origin whitelist** (`allowedOrigins`): If a request arrives with an `Origin` header not in the list, the adapter returns `403`. Requests without an `Origin` header (CLI tools, server-to-server, MCP SDK clients) are always allowed.

**SEP-2243 header enforcement** (opt-in via `requireSep2243: true`): Requires `Mcp-Method` to be present on every POST and match the JSON-RPC body's `method`. For `tools/call`, also requires `Mcp-Name`. Enable this only when your clients (e.g. browser-side MCP proxies) send these headers; the standard `StreamableHTTPClientTransport` from the SDK does **not** send them.

### Auth delegation

The adapter does **not** validate tokens. Authentication is delegated to the framework's native middleware:

- **Express**: any middleware that sets `req.auth` before the MCP router runs (e.g. Passport, `express-oauth2-jwt-bearer`)
- **Fastify**: a `preHandler` hook that sets `request.raw.auth`

The auth value is propagated to `ctx.auth` in `onToolCall`.

---

## Extension: `x-mcp-header` (header-borne parameters)

_This is a project-specific extension, not part of any MCP SEP._

Mark a tool parameter with `x-mcp-header: true` in its JSON Schema to indicate that a client can supply it via a `Mcp-Param-<Title-Kebab>` HTTP header instead of (or in addition to) the JSON-RPC arguments body.

**Declaring with Zod** (Express/Fastify packages):

```ts
import { mcpHeader } from "@mcp-auto-expose/express"; // or "@mcp-auto-expose/fastify"
import { z } from "zod";

const schema = z.object({
  tenant_id: mcpHeader(z.string().describe("Resolved from gateway auth context")),
  invoice_id: z.string(),
});
```

The `mcpHeader()` wrapper stamps `"x-mcp-header": true` on the generated JSON Schema property.

**Mapping rule** (snake_case ↔ Title-Kebab-Case):

| Schema key             | Header name                      |
| ---------------------- | -------------------------------- |
| `tenant_id`            | `Mcp-Param-Tenant-Id`            |
| `invoice_external_ref` | `Mcp-Param-Invoice-External-Ref` |

**Merge policy** (header wins on conflict):

| Situation     | args result                                  |
| ------------- | -------------------------------------------- |
| Header only   | injected into args                           |
| Body only     | kept as-is                                   |
| Both match    | kept as-is                                   |
| Both conflict | header value used; warning emitted to stderr |

---

## SEP-2243 curl examples

```sh
# initialize
curl -sN -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Method: initialize" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# tools/list
curl -sN -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Method: tools/list" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# tools/call with Mcp-Param-* header
curl -sN -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Method: tools/call" -H "Mcp-Name: get_user_by_id" \
  -H "Mcp-Param-Tenant-Id: acme" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_user_by_id","arguments":{"id":"u1"}}}'

# SEP-2243 mismatch — 400 (only when requireSep2243: true)
curl -sN -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -H "Mcp-Method: tools/list" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call"}'

# Origin rejected — 403
curl -sN -X POST http://127.0.0.1:3000/mcp \
  -H "Origin: https://evil.example" \
  -H "Content-Type: application/json" -H "Mcp-Method: tools/list" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/list"}'

# SSE GET
curl -sN -X GET http://127.0.0.1:3000/mcp -H "Accept: text/event-stream"
```
