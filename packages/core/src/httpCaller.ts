import { reconstructRequest } from "./reconstructRequest.js";
import type { MCPTool } from "./types.js";

export interface CallToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export type OnToolCall = (tool: MCPTool, args: unknown, ctx?: unknown) => Promise<CallToolResult>;

export interface HttpCallerOptions {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

export function makeHttpCaller(opts: HttpCallerOptions): OnToolCall {
  const { baseUrl, defaultHeaders = {}, timeoutMs = 30_000 } = opts;

  return async (tool, rawArgs, ctx): Promise<CallToolResult> => {
    const args = (rawArgs ?? {}) as Record<string, unknown>;
    const { url, querystring, body, headers: mcpParamHeaders } = reconstructRequest(tool, args);

    const fullUrl = `${baseUrl}${url}${querystring}`;
    const hasBody = BODY_METHODS.has(tool._source.method);

    const requestHeaders: Record<string, string> = {
      ...defaultHeaders,
      ...mcpParamHeaders,
    };
    if (hasBody) {
      requestHeaders["Content-Type"] = "application/json";
    }

    // SEP-414: propagate W3C Trace Context to the backend
    const trace = (ctx as { traceContext?: Record<string, string> } | undefined)?.traceContext;
    if (trace?.traceparent) requestHeaders["Traceparent"] = trace.traceparent;
    if (trace?.tracestate) requestHeaders["Tracestate"] = trace.tracestate;
    if (trace?.baggage) requestHeaders["Baggage"] = trace.baggage;

    let response: Response;
    try {
      response = await fetch(fullUrl, {
        method: tool._source.method,
        headers: requestHeaders,
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[mcp-auto-expose] backend call failed: ${msg} (${tool._source.method} ${fullUrl})\n`,
      );
      return {
        content: [{ type: "text", text: `Backend error: ${msg}` }],
        isError: true,
      };
    }

    const text = await response.text();

    if (!response.ok) {
      process.stderr.write(
        `[mcp-auto-expose] backend returned ${response.status} for ${tool._source.method} ${fullUrl}\n`,
      );
      return {
        content: [{ type: "text", text: text }],
        isError: true,
      };
    }

    return { content: [{ type: "text", text }] };
  };
}
