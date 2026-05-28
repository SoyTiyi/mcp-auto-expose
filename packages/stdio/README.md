# @mcp-auto-expose/stdio

Connects the tool catalog produced by any `mcp-auto-expose` adapter to a local MCP server using the stdio transport.

## Basic usage

```ts
import Fastify from "fastify";
import { autoExpose } from "@mcp-auto-expose/fastify";
import { startStdio } from "@mcp-auto-expose/stdio";

const app = Fastify({ logger: { stream: process.stderr } }); // <-- stderr required
await app.register(autoExpose);

// define your routes here...

await app.ready();
await startStdio({
  name: "my-mcp-server",
  version: "1.0.0",
  tools: app.mcpAutoExpose.tools(),
});
```

The process blocks listening on `stdin`/`stdout` for the JSON-RPC 2.0 protocol.

## API

### `startStdio(options): Promise<StartStdioHandle>`

| Option         | Type        | Default     | Description                                              |
| -------------- | ----------- | ----------- | -------------------------------------------------------- |
| `name`         | `string`    | —           | MCP server name                                          |
| `version`      | `string`    | —           | Server version                                           |
| `tools`        | `MCPTool[]` | —           | Array produced by `app.mcpAutoExpose.tools()`            |
| `installGuard` | `boolean`   | `true`      | Installs the global `console.*` → stderr guard           |
| `onToolCall`   | function    | placeholder | Hook for real tool invocation (see next phase)           |

**`StartStdioHandle.close()`**: gracefully closes the MCP server.

### `installStdoutGuard()` / `restoreStdoutGuard()`

Global patch of `console.*` that redirects all output to `stderr`, protecting the JSON-RPC pipe on `stdout`. It is idempotent. `restoreStdoutGuard()` reverts the state (useful in tests).

## Contractual constraints

### `process.stdout.write` is reserved for the protocol

The MCP SDK's `StdioServerTransport` writes directly to the process `stdout`. The guard does NOT intercept `process.stdout.write` — doing so would destroy the protocol. **Host code must not write to `process.stdout` or any streams that drain into it.**

### Fastify logger

Pino (Fastify v5's default logger) writes to `stdout` unless explicitly configured otherwise. In stdio mode it is **required** to configure it to point to `stderr`:

```ts
// Option 1: explicit stream
const app = Fastify({ logger: { stream: process.stderr } });

// Option 2: disable
const app = Fastify({ logger: false });
```

### tools/call

In Phase 2, `tools/call` returns a structured placeholder with the HTTP method and destination URL. The actual invocation of the Fastify handler is implemented in a later phase (requires extending `MCPTool._source` with the flatten → `{params, querystring, body}` mapping).
