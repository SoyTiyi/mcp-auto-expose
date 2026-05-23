/**
 * Smoke: Streamable HTTP transport via Express
 *
 * Start:  node --import tsx apps/dev-sandbox/src/http-express-main.ts
 *
 * curl examples (see packages/http/README.md for full reference):
 *
 *   # initialize
 *   curl -sN -X POST http://127.0.0.1:3000/mcp \
 *     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
 *     -H "Mcp-Method: initialize" \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
 *
 *   # list tools
 *   curl -sN -X POST http://127.0.0.1:3000/mcp \
 *     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
 *     -H "Mcp-Method: tools/list" \
 *     -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
 *
 *   # call tool with Mcp-Param-* header
 *   curl -sN -X POST http://127.0.0.1:3000/mcp \
 *     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
 *     -H "Mcp-Method: tools/call" -H "Mcp-Name: get_user_by_id" \
 *     -H "Mcp-Param-Tenant-Id: acme" \
 *     -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_user_by_id","arguments":{"id":"u1"}}}'
 */

import express, { Router } from "express";
import { z } from "zod/v3";
import { autoExpose, mcpExpose, mcpHeader } from "@mcp-auto-expose/express";
import { mountMcpExpress } from "@mcp-auto-expose/http/express";

const app = express();
app.use(express.json());

const handle = autoExpose(app, { strictSchema: true });

const router = Router();

router.get(
  "/users",
  mcpExpose({ description: "List all users" }),
  (_req, res) => { res.json([]); },
);

router.get(
  "/users/:id",
  mcpExpose({
    params: z.object({ id: z.string(), tenant_id: mcpHeader(z.string()) }),
    description: "Get user by ID (tenant_id carried via Mcp-Param-Tenant-Id)",
  }),
  (_req, res) => { res.json({}); },
);

router.post(
  "/users",
  mcpExpose({
    body: z.object({ name: z.string(), email: z.string().email() }),
    description: "Create a new user",
  }),
  (_req, res) => { res.status(201).json({}); },
);

router.delete(
  "/users/:id",
  mcpExpose({ description: "Delete a user by ID" }),
  (_req, res) => { res.json({ deleted: true }); },
);

app.use("/api", router);

const tools = handle.tools();

const { router: mcpRouter } = mountMcpExpress({
  name: "http-express-smoke",
  version: "0.0.0",
  tools,
  allowedOrigins: ["http://localhost:5173"],
  onToolCall: async (tool, args) => ({
    content: [{ type: "text", text: `[smoke] ${tool.name} called with ${JSON.stringify(args)}` }],
  }),
});

app.use(mcpRouter);

app.listen(3000, "127.0.0.1", () => {
  process.stderr.write("[mcp-auto-expose:smoke] HTTP Express listening on http://127.0.0.1:3000/mcp\n");
  process.stderr.write(`[mcp-auto-expose:smoke] ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}\n`);
});
