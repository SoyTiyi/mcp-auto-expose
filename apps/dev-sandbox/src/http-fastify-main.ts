/**
 * Smoke: Streamable HTTP transport via Fastify
 *
 * Start:  node --import tsx apps/dev-sandbox/src/http-fastify-main.ts
 *
 * curl examples (port 3001):
 *
 *   # list tools
 *   curl -sN -X POST http://127.0.0.1:3001/mcp \
 *     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
 *     -H "Mcp-Method: tools/list" \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
 *
 *   # invoke a tool (should return real backend data)
 *   curl -sN -X POST http://127.0.0.1:3001/mcp \
 *     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
 *     -H "Mcp-Method: tools/call" -H "Mcp-Name: list_api_users" \
 *     -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_api_users","arguments":{}}}'
 */

import Fastify from "fastify";
import { autoExpose } from "@mcp-auto-expose/fastify";
import { mcpFastifyPlugin } from "@mcp-auto-expose/http/fastify";

const fastify = Fastify({ logger: false });
await fastify.register(autoExpose);

fastify.get(
  "/api/users",
  {},
  async () => [{ id: "u1", name: "Ana" }, { id: "u2", name: "Bob" }],
);

fastify.get(
  "/api/users/:id",
  {
    schema: {
      description: "Get user by ID",
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  },
  async (req) => {
    const { id } = req.params as { id: string };
    return { id, name: id === "u1" ? "Ana" : "Unknown" };
  },
);

fastify.post(
  "/api/users",
  {
    schema: {
      description: "Create a new user",
      body: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
        },
        required: ["name", "email"],
      },
    },
  },
  async (req) => {
    const { name, email } = req.body as { name: string; email: string };
    return { id: "u3", name, email };
  },
);

fastify.delete(
  "/api/users/:id",
  {
    schema: {
      description: "Delete a user by ID",
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  },
  async () => ({ deleted: true }),
);

await fastify.ready();

const tools = fastify.mcpAutoExpose.tools();

await fastify.register(mcpFastifyPlugin, {
  name: "http-fastify-smoke",
  version: "0.0.0",
  tools,
  allowedOrigins: ["http://localhost:5173"],
  apiBaseUrl: "http://127.0.0.1:3001",
});

await fastify.listen({ port: 3001, host: "127.0.0.1" });
process.stderr.write("[mcp-auto-expose:smoke] HTTP Fastify listening on http://127.0.0.1:3001/mcp\n");
process.stderr.write(`[mcp-auto-expose:smoke] ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}\n`);
