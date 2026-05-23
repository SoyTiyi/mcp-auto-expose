import Fastify from "fastify";
import { autoExpose } from "../src/index.js";

const app = Fastify();
await app.register(autoExpose);

app.get("/api/users", { schema: { description: "Listar usuarios" } }, async () => []);
app.get("/api/users/:id", {
  schema: {
    description: "Obtener usuario por id",
    params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
}, async () => ({}));
app.post("/api/users", {
  schema: {
    description: "Crear usuario",
    body: {
      type: "object",
      properties: { name: { type: "string" }, email: { type: "string" } },
      required: ["name", "email"],
    },
  },
}, async () => ({}));

await app.ready();
process.stderr.write(JSON.stringify(app.mcpAutoExpose.tools(), null, 2) + "\n");
await app.close();
