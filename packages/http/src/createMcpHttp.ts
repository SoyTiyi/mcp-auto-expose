import type { IncomingMessage, ServerResponse } from "node:http";
import type { MCPTool } from "@mcp-auto-expose/core";

export interface McpHttpContext {
  headers: Record<string, string | string[] | undefined>;
  auth?: unknown;
  mcp: { method: string; name: string };
  headerParams: Record<string, string>;
}

export type OnToolCallHttp = (
  tool: MCPTool,
  args: unknown,
  ctx: McpHttpContext,
) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;

export interface McpHttpOptions {
  path?: string;
  allowedOrigins?: string[];
  session?: "stateful" | "stateless";
  sessionIdGenerator?: () => string;
  enableJsonResponse?: boolean;
  warnOnNonLocalhost?: boolean;
  tools: MCPTool[];
  name: string;
  version: string;
  onToolCall: OnToolCallHttp;
}

export type McpIncomingMessage = IncomingMessage & { auth?: unknown; body?: unknown };

export interface McpHttpHandle {
  handleNodeRequest(req: McpIncomingMessage, res: ServerResponse): Promise<void>;
  close(): Promise<void>;
}

export function createMcpHttp(_options: McpHttpOptions): McpHttpHandle {
  throw new Error("not implemented");
}
