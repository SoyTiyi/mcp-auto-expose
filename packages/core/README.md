# @mcp-auto-expose/core

Core types and functions for the `mcp-auto-expose` library.

## API

### `resolveTool(descriptor: RouteDescriptor): MCPTool`

Converts a `RouteDescriptor` (from any framework adapter) to an MCP `Tool` contract.

```typescript
import { resolveTool } from "@mcp-auto-expose/core";

const tool = resolveTool({
  framework: "fastify",
  method: "GET",
  url: "/api/users/:id",
  schema: {
    description: "Get user by ID",
    params: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
});
// tool.name === "get_users_by_id"
// tool.inputSchema.properties.id.type === "string"
```

### `ToolRegistry`

```typescript
import { ToolRegistry } from "@mcp-auto-expose/core";

const registry = new ToolRegistry();
registry.register(tool);
const tools = registry.list(); // sorted alphabetically
```
