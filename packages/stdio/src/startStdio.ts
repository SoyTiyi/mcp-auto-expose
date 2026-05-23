import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { MCPTool } from "@mcp-auto-expose/core";
import { installStdoutGuard } from "./stdoutGuard.js";
import { registerTools } from "./registerTools.js";

export interface StartStdioOptions {
  name: string;
  version: string;
  tools: MCPTool[];
  /** Default true. Set false only in isolated tests. */
  installGuard?: boolean;
  /** Optional hook for tool invocations. Fase 2 default = structured placeholder. */
  onToolCall?: (
    tool: MCPTool,
    args: unknown,
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

export interface StartStdioHandle {
  close(): Promise<void>;
}

interface Deps {
  server?: Server;
  transport?: StdioServerTransport;
}

export async function startStdio(
  options: StartStdioOptions,
  /** For testing only — allows injecting pre-built server/transport. */
  _deps?: Deps,
): Promise<StartStdioHandle> {
  if (options.installGuard !== false) installStdoutGuard();

  const server =
    _deps?.server ??
    new Server(
      { name: options.name, version: options.version },
      { capabilities: { tools: {} } },
    );

  registerTools({ server, tools: options.tools, onToolCall: options.onToolCall });

  const transport = _deps?.transport ?? new StdioServerTransport();
  await server.connect(transport);

  return {
    async close() {
      await server.close();
    },
  };
}
