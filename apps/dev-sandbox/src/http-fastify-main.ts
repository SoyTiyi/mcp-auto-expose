/**
 * Smoke: Streamable HTTP transport via Fastify
 *
 * Start:  node --import tsx apps/dev-sandbox/src/http-fastify-main.ts
 *
 * curl examples (same paths as http-express-main.ts but port 3001):
 *
 *   # initialize
 *   curl -sN -X POST http://127.0.0.1:3001/mcp \
 *     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
 *     -H "Mcp-Method: initialize" \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
 *
 *   # list tools
 *   curl -sN -X POST http://127.0.0.1:3001/mcp \
 *     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
 *     -H "Mcp-Method: tools/list" \
 *     -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
 */

import Fastify from "fastify";
import { z } from "zod/v3";
import type { MCPTool } from "@mcp-auto-expose/http";
import { mcpFastifyPlugin } from "@mcp-auto-expose/http/fastify";

// Manual tool definitions (Fastify adapter doesn't use autoExpose for HTTP yet)
const tools: MCPTool[] = [
  {
    name: "list_users",
    description: "List all users",
    inputSchema: { type: "object", properties: {}, required: [] },
    _source: { framework: "fastify", method: "GET", url: "/users" },
  },
  {
    name: "get_user_by_id",
    description: "Get user by ID (tenant_id via Mcp-Param-Tenant-Id)",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        tenant_id: { type: "string", "x-mcp-header": true },
      },
      required: ["id"],
    },
    _source: { framework: "fastify", method: "GET", url: "/users/:id" },
  },
  {
    name: "create_user",
    description: "Create a new user",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
      },
      required: ["name", "email"],
    },
    _source: { framework: "fastify", method: "POST", url: "/users" },
  },
];

// Suppress unused import lint warning
void z;

const fastify = Fastify({ logger: false });

await fastify.register(mcpFastifyPlugin, {
  name: "http-fastify-smoke",
  version: "0.0.0",
  tools,
  allowedOrigins: ["http://localhost:5173"],
  onToolCall: async (tool, args) => ({
    content: [{ type: "text", text: `[smoke] ${tool.name} called with ${JSON.stringify(args)}` }],
  }),
});

await fastify.listen({ port: 3001, host: "127.0.0.1" });
process.stderr.write("[mcp-auto-expose:smoke] HTTP Fastify listening on http://127.0.0.1:3001/mcp\n");
process.stderr.write(`[mcp-auto-expose:smoke] ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}\n`);
