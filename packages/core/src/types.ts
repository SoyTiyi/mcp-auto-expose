export type HTTPMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export type ParamOrigin = "params" | "querystring" | "body";

/** Minimal result type returned by tool call handlers. Mirrors CallToolResult in httpCaller.ts. */
export interface ToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface MCPToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface RouteSchema {
  body?: Record<string, unknown>;
  querystring?: Record<string, unknown>;
  params?: Record<string, unknown>;
  description?: string;
  summary?: string;
  tags?: string[];
  hide?: boolean;
}

export interface RouteDescriptor {
  framework: string;
  method: HTTPMethod;
  url: string;
  schema?: RouteSchema;
}

// Symbol-keyed internal property — not accessible without the symbol reference.
// Declared here (source of truth) and re-exported via ./internal.ts.
// The unique symbol type is obtained from the class static so that TypeScript
// emits it correctly in declaration (.d.ts) files for cross-package use.
/** @internal */
class _InternalSourceKey {
  static readonly INTERNAL_SOURCE: unique symbol = Symbol.for("mcp-auto-expose/source") as never;
}

export const INTERNAL_SOURCE: typeof _InternalSourceKey.INTERNAL_SOURCE =
  _InternalSourceKey.INTERNAL_SOURCE;

export interface InternalSource {
  paramMap: Record<string, ParamOrigin>;
  framework: string;
  url: string;
  method: HTTPMethod;
  /**
   * Presente solo en tools creadas con defineTool().
   * Si existe, se invoca directamente en lugar de hacer fetch HTTP.
   */
  execute?: (args: unknown) => Promise<ToolCallResult> | ToolCallResult;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: MCPToolInputSchema;
  [INTERNAL_SOURCE]: InternalSource;
}
