import Fastify from "fastify";
import { autoExpose } from "@mcp-auto-expose/fastify";
import { startStdio } from "@mcp-auto-expose/stdio";

const app = Fastify({ logger: { stream: process.stderr } });
await app.register(autoExpose);

app.get("/api/users", async () => [{ id: "u1", name: "Ana" }]);

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
  async (req) => {
    const { id } = req.params as { id: string };
    return { id, name: "Ana" };
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
  async (req) => {
    const { name, email } = req.body as { name: string; email: string };
    return { id: "u2", name, email };
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
