import Fastify from "fastify";
import { autoExpose } from "@mcp-auto-expose/fastify";
import { startStdio } from "@mcp-auto-expose/stdio";

const app = Fastify({ logger: { stream: process.stderr } });
await app.register(autoExpose);

app.get("/api/users", async () => []);

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
  async () => ({}),
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
  async () => ({}),
);

await app.ready();

await startStdio({
  name: "dev-sandbox",
  version: "0.0.0",
  tools: app.mcpAutoExpose.tools(),
});
