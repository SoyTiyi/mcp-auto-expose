/**
 * Smoke: Streamable HTTP transport via Fastify
 *
 * Start:  pnpm --filter=dev-sandbox dev:http-fastify
 *
 * curl examples (port 3001):
 *
 *   # list tools
 *   curl -sN -X POST http://127.0.0.1:3001/mcp \
 *     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
 *     -H "Mcp-Method: tools/list" \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
 *
 *   # invoke a tool
 *   curl -sN -X POST http://127.0.0.1:3001/mcp \
 *     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
 *     -H "Mcp-Method: tools/call" -H "Mcp-Name: list_api_users" \
 *     -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_api_users","arguments":{}}}'
 */

import Fastify from "fastify";
import { autoExpose } from "@mcp-auto-expose/fastify";
import { mcpFastifyPlugin } from "@mcp-auto-expose/http/fastify";

interface User {
  id: string;
  name: string;
  email: string;
}

const db: Map<string, User> = new Map();
let nextId = 1;

const fastify = Fastify({ logger: false });
await fastify.register(autoExpose);

fastify.get(
  "/api/users",
  {
    schema: { description: "List all users" },
  },
  async () => Array.from(db.values()),
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
  async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = db.get(id);
    if (!user) return reply.status(404).send({ error: "User not found" });
    return user;
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
  async (req, reply) => {
    const { name, email } = req.body as { name: string; email: string };
    const id = `u${nextId++}`;
    const user: User = { id, name, email };
    db.set(id, user);
    return reply.status(201).send(user);
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
  async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!db.has(id)) return reply.status(404).send({ error: "User not found" });
    db.delete(id);
    return { deleted: true };
  },
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
