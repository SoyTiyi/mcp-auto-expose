# @mcp-auto-expose/fastify

Fastify plugin that auto-discovers routes and exposes them as MCP tools.

## Installation

```sh
pnpm add @mcp-auto-expose/fastify fastify
```

## Usage

```typescript
import Fastify from "fastify";
import { autoExpose } from "@mcp-auto-expose/fastify";

const app = Fastify();
await app.register(autoExpose);

app.get("/api/users", { schema: { description: "List users" } }, async () => []);
app.get("/api/users/:id", {
  schema: {
    description: "Get user by ID",
    params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
}, async () => ({}));

await app.ready();

const tools = app.mcpAutoExpose.tools();
// tools[0].name === "get_users_by_id"
// tools[1].name === "list_users"
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `strictSchema` | `boolean` | `false` | If `true`, routes without body/querystring/params schema are not exposed |

## Excluding routes

```typescript
// Skip via Swagger/OpenAPI convention:
app.get("/internal", { schema: { hide: true } }, handler);

// Skip explicitly:
app.get("/internal", { config: { mcpExpose: false } }, handler);
```
