import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { MCPTool, HttpCallerOptions } from "@mcp-auto-expose/core";
import { makeHttpCaller } from "@mcp-auto-expose/core";
import { installStdoutGuard } from "./stdoutGuard.js";
import { registerTools } from "./registerTools.js";

export interface StartStdioOptions {
  name: string;
  version: string;
  tools: MCPTool[];
  installGuard?: boolean;
  apiBaseUrl?: string;
  apiCallerOptions?: Omit<HttpCallerOptions, "baseUrl">;
  onToolCall?: (
    tool: MCPTool,
    args: unknown,
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

export interface StartStdioHandle {
  close(): Promise<void>;
}

interface Deps {
  server?: McpServer;
  transport?: StdioServerTransport;
}

export async function startStdio(
  options: StartStdioOptions,
  /** For testing only — allows injecting pre-built server/transport. */
  _deps?: Deps,
): Promise<StartStdioHandle> {
  const resolvedOnToolCall = (() => {
    if (options.onToolCall) return options.onToolCall;
    if (options.apiBaseUrl) {
      return makeHttpCaller({
        baseUrl: options.apiBaseUrl,
        ...options.apiCallerOptions,
      });
    }
    throw new Error(
      "[mcp-auto-expose/stdio] startStdio requires either 'apiBaseUrl' or 'onToolCall'.",
    );
  })();

  if (options.installGuard !== false) installStdoutGuard();

  const server =
    _deps?.server ??
    new McpServer(
      { name: options.name, version: options.version },
      { capabilities: { tools: {} } },
    );

  registerTools({ server, tools: options.tools, onToolCall: resolvedOnToolCall });

  const transport = _deps?.transport ?? new StdioServerTransport();
  await server.connect(transport);

  return {
    async close() {
      await server.close();
    },
  };
}
