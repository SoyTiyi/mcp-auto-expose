/**
 * MCP SDK client smoke test — verifies catalog and tool call against a running HTTP server.
 *
 * Requires http-express-main.ts (port 3000) to be running first:
 *   node --import tsx apps/dev-sandbox/src/http-express-main.ts &
 *
 * Run:
 *   node --import tsx apps/dev-sandbox/src/http-client-smoke.ts
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE_URL = process.env["MCP_SERVER_URL"] ?? "http://127.0.0.1:3000/mcp";

const transport = new StreamableHTTPClientTransport(new URL(BASE_URL));
const client = new Client({ name: "http-client-smoke", version: "0.0.0" });

await client.connect(transport);
process.stderr.write(`[mcp-client-smoke] Connected to ${BASE_URL}\n`);

// List tools
const { tools } = await client.listTools();
process.stderr.write(`[mcp-client-smoke] ${tools.length} tool(s): ${tools.map((t: { name: string }) => t.name).join(", ")}\n`);

if (tools.length === 0) {
  process.stderr.write("[mcp-client-smoke] ERROR: no tools found\n");
  process.exit(1);
}

// Call one tool
const firstTool = tools[0]!;
const callResult = await client.callTool({
  name: firstTool.name,
  arguments: {},
});
process.stderr.write(`[mcp-client-smoke] callTool(${firstTool.name}) → ${JSON.stringify(callResult.content)}\n`);

await client.close();
process.stderr.write("[mcp-client-smoke] OK — all checks passed\n");
