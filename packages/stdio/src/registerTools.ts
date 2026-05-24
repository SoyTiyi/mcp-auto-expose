import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { MCPTool } from "@mcp-auto-expose/core";
import type { Server } from "@modelcontextprotocol/sdk/server";

export interface RegisterToolsOptions {
  server: Server;
  tools: MCPTool[];
  onToolCall: (
    tool: MCPTool,
    args: unknown,
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

export function registerTools({ server, tools, onToolCall }: RegisterToolsOptions): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const tool = tools.find((t) => t.name === name);

    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool: "${name}"` }],
        isError: true,
      };
    }

    return await onToolCall(tool, req.params.arguments ?? {});
  });
}
