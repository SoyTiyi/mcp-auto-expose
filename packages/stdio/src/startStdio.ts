import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { MCPTool, HttpCallerOptions, OnToolCall } from "@mcp-auto-expose/core";
import { makeHttpCaller } from "@mcp-auto-expose/core";
import { INTERNAL_SOURCE } from "@mcp-auto-expose/core/internal";
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
  // Build a base HTTP caller if configured (may be undefined)
  const baseHttpCaller = options.onToolCall ?? (
    options.apiBaseUrl
      ? makeHttpCaller({ baseUrl: options.apiBaseUrl, ...options.apiCallerOptions })
      : undefined
  );

  const resolvedOnToolCall: OnToolCall = async (tool, args, ctx?) => {
    // `!` needed: TS widens required symbol-keyed properties to `T | undefined` (TS#42192)
    const src = tool[INTERNAL_SOURCE]!;
    if (typeof src.execute === "function") {
      return src.execute(args);
    }
    if (baseHttpCaller) {
      return baseHttpCaller(tool, args, ctx);
    }
    return {
      content: [{ type: "text", text: `[mcp-auto-expose/stdio] Tool "${tool.name}" has no executor. Provide apiBaseUrl or onToolCall, or use defineTool() to add an execute handler.` }],
      isError: true,
    };
  };

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
