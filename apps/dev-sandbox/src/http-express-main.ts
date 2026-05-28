/**
 * Smoke: Streamable HTTP transport via Express
 *
 * Start:  node --import tsx apps/dev-sandbox/src/http-express-main.ts
 *
 * curl examples:
 *
 *   # list tools
 *   curl -sN -X POST http://127.0.0.1:3000/mcp \
 *     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
 *     -H "Mcp-Method: tools/list" \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
 *
 *   # invoke a tool (should return real backend data, not a placeholder)
 *   curl -sN -X POST http://127.0.0.1:3000/mcp \
 *     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
 *     -H "Mcp-Method: tools/call" -H "Mcp-Name: list_users" \
 *     -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_users","arguments":{}}}'
 */

import express, { Router } from "express";
import { z } from "zod";
import { autoExpose, mcpExpose, mcpHeader } from "@mcp-auto-expose/express";
import { mountMcpExpress } from "@mcp-auto-expose/http/express";

const app = express();
app.use(express.json());

const handle = autoExpose(app, { strictSchema: true });

const router = Router();

router.get("/users", mcpExpose({ description: "List all users" }), (_req, res) => {
  res.json([
    { id: "u1", name: "Ana" },
    { id: "u2", name: "Bob" },
  ]);
});

router.get(
  "/users/:id",
  mcpExpose({
    params: z.object({ id: z.string(), tenant_id: mcpHeader(z.string(), "TenantId") }),
    description: "Get user by ID (tenant_id carried via Mcp-Param-TenantId)",
  }),
  (req, res) => {
    const { id } = req.params as { id: string };
    res.json({ id, name: id === "u1" ? "Ana" : "Unknown" });
  },
);

router.post(
  "/users",
  mcpExpose({
    body: z.object({ name: z.string(), email: z.string().email() }),
    description: "Create a new user",
  }),
  (req, res) => {
    const { name, email } = req.body as { name: string; email: string };
    res.status(201).json({ id: "u3", name, email });
  },
);

router.delete("/users/:id", mcpExpose({ description: "Delete a user by ID" }), (_req, res) => {
  res.json({ deleted: true });
});

app.use("/api", router);

const tools = handle.tools();

const { router: mcpRouter } = mountMcpExpress({
  name: "http-express-smoke",
  version: "0.0.0",
  tools,
  allowedOrigins: ["http://localhost:5173"],
  apiBaseUrl: "http://127.0.0.1:3000",
});

app.use(mcpRouter);

app.listen(3000, "127.0.0.1", () => {
  process.stderr.write(
    "[mcp-auto-expose:smoke] HTTP Express listening on http://127.0.0.1:3000/mcp\n",
  );
  process.stderr.write(
    `[mcp-auto-expose:smoke] ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}\n`,
  );
});
