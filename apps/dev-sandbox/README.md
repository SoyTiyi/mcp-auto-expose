# dev-sandbox

Test application that composes the Phase 1 Fastify adapter with the Phase 2 stdio transport.

## Usage

```sh
# From the monorepo root:
pnpm --filter dev-sandbox dev
```

The process listens on `stdin`. Any MCP client can connect by launching it as a subprocess.

## Manual smoke verification

```sh
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| pnpm --filter dev-sandbox exec node --import tsx src/main.ts \
  2>sandbox.stderr.log
```

**Expected stdout** (two JSON-RPC lines):

1. `initialize` response with `serverInfo.name: "dev-sandbox"` and `capabilities.tools: {}`.
2. `tools/list` response with 3 tools: `list_users`, `get_users_by_id`, `create_users`.

**stdout guard verification** — any `console.log` emitted by host code **before** `startStdio()` escapes to stdout. After `startStdio()` installs the guard, all `console.*` is redirected to stderr. To verify:

```sh
# Add console.log("NOISE") in main.ts AFTER await startStdio(...)
# and verify that stdout does not contain "NOISE" but sandbox.stderr.log does.
```

## Note on Fastify logger

In stdio context, the Fastify logger must point to `stderr`:

```ts
const app = Fastify({ logger: { stream: process.stderr } });
// or disable completely:
const app = Fastify({ logger: false });
```

Pino writes to `stdout` by default — failing to configure this would contaminate the JSON-RPC pipe.
