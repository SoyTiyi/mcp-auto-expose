import Fastify from "fastify";
import { autoExpose } from "@mcp-auto-expose/fastify";
import { startStdio } from "@mcp-auto-expose/stdio";

interface User {
  id: string;
  name: string;
  email: string;
}

const db: Map<string, User> = new Map([
  ["u1", { id: "u1", name: "Ana", email: "ana@example.com" }],
]);
let nextId = 2;

const app = Fastify({ logger: { stream: process.stderr } });
await app.register(autoExpose);

app.get(
  "/api/users",
  {
    schema: {
      description: "List all users",
    },
  },
  async () => Array.from(db.values()),
);

app.get(
  "/api/users/:id",
  {
    schema: {
      description: "Get user by id",
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

app.post(
  "/api/users",
  {
    schema: {
      description: "Create a user",
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

app.delete(
  "/api/users/:id",
  {
    schema: {
      description: "Delete a user by id",
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

await app.listen({ port: 3010, host: "127.0.0.1" });

const stdioHandle = await startStdio({
  name: "dev-sandbox",
  version: "0.0.0",
  tools: app.mcpAutoExpose.tools(),
  apiBaseUrl: "http://127.0.0.1:3010",
});

process.on("SIGTERM", async () => {
  await stdioHandle.close();
  await app.close();
});
