import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { MCPTool, HttpCallerOptions } from "@mcp-auto-expose/core";
import { makeHttpCaller } from "@mcp-auto-expose/core";
import { INTERNAL_SOURCE } from "@mcp-auto-expose/core/internal";
import { checkOrigin } from "./origin.js";
import { validateSep2243 } from "./sep2243.js";
import { validateAndMergeHeaderParams } from "./headerParams.js";
import { sanitizeToolXMcpHeaders } from "./xMcpHeader.js";
import { localhostWarn } from "./localhostWarn.js";
import { warn } from "./warn.js";

export interface McpHttpContext {
  headers: Record<string, string | string[] | undefined>;
  auth?: unknown;
  mcp: { method: string; name: string };
  headerParams: Record<string, string>;
  /** SEP-414: W3C Trace Context extracted from incoming HTTP headers. Propagated
   *  to backend calls by makeHttpCaller as Traceparent/Tracestate/Baggage headers. */
  traceContext?: {
    traceparent?: string;
    tracestate?: string;
    baggage?: string;
  };
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
  /** Enforce SEP-2243 header coherence (Mcp-Method + Mcp-Name). Default true.
   *  Disable only for testing or non-browser deployments where CSRF risk is absent. */
  requireSep2243?: boolean;
  tools: MCPTool[];
  name: string;
  version: string;
  apiBaseUrl?: string;
  apiCallerOptions?: Omit<HttpCallerOptions, "baseUrl">;
  onToolCall?: OnToolCallHttp;
  /** SEP-2549 CacheableResult. When set, `tools/list` responses include
   *  `_meta.ttlMs` and `_meta.cacheScope` so clients can cache the tool catalog. */
  toolsListCache?: {
    ttlMs: number;
    cacheScope: "session" | "global";
  };
}

export type McpIncomingMessage = IncomingMessage & { auth?: unknown; body?: unknown };

export interface McpHttpHandle {
  handleNodeRequest(req: McpIncomingMessage, res: ServerResponse): Promise<void>;
  close(): Promise<void>;
}

function buildEmptyCtx(): McpHttpContext {
  return { headers: {}, mcp: { method: "", name: "" }, headerParams: {} };
}

function extractTraceContext(
  headers: Record<string, string | string[] | undefined>,
): McpHttpContext["traceContext"] {
  const get = (k: string): string | undefined => {
    const v = headers[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
  };
  const traceparent = get("traceparent");
  const tracestate = get("tracestate");
  const baggage = get("baggage");
  if (!traceparent && !tracestate && !baggage) return undefined;
  return {
    ...(traceparent ? { traceparent } : {}),
    ...(tracestate ? { tracestate } : {}),
    ...(baggage ? { baggage } : {}),
  };
}

function replyJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function extractRequestId(body: unknown): number | string | null {
  if (body !== null && typeof body === "object") {
    const id = (body as Record<string, unknown>)["id"];
    if (typeof id === "number" || typeof id === "string") return id;
  }
  return null;
}

function replyHeaderMismatch(res: ServerResponse, body: unknown, reason: string): void {
  const id = extractRequestId(body);
  res.writeHead(400, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32001,
        message: "HeaderMismatch",
        data: { reason },
      },
    }),
  );
}

export function createMcpHttp(options: McpHttpOptions): McpHttpHandle {
  const {
    allowedOrigins = [],
    session = "stateless",
    sessionIdGenerator,
    enableJsonResponse = false,
    warnOnNonLocalhost = true,
    tools,
    name,
    version,
  } = options;

  const requireSep2243 = options.requireSep2243 ?? true;
  if (requireSep2243 === false) {
    warn("sep2243-disabled", {
      hint: "SEP-2243 enforcement is OFF — only for testing. Production MUST keep it enabled.",
    });
  }

  // Sanitize x-mcp-header annotations on every tool's inputSchema at construction time.
  // Invalid (non-string / non-primitive / duplicate) annotations are stripped + warned.
  for (const t of tools) {
    sanitizeToolXMcpHeaders(t.name, t.inputSchema as unknown as Record<string, unknown>, warn);
  }

  const _httpCaller = options.apiBaseUrl
    ? makeHttpCaller({ baseUrl: options.apiBaseUrl, ...options.apiCallerOptions })
    : undefined;

  const onToolCall: OnToolCallHttp = async (tool, args, ctx) => {
    // `!` needed: TS widens required symbol-keyed properties to `T | undefined` (TS#42192)
    const src = tool[INTERNAL_SOURCE]!;
    if (typeof src.execute === "function") {
      return src.execute(args);
    }
    if (options.onToolCall) return options.onToolCall(tool, args, ctx);
    if (_httpCaller) return _httpCaller(tool, args, ctx);
    return {
      content: [
        {
          type: "text",
          text: `[mcp-auto-expose/http] Tool "${tool.name}" has no executor. Provide apiBaseUrl or onToolCall, or use defineTool() to add an execute handler.`,
        },
      ],
      isError: true,
    };
  };

  localhostWarn(warnOnNonLocalhost);

  const httpContextStorage = new AsyncLocalStorage<McpHttpContext>();

  // Creates a new Server instance with all handlers registered.
  // Stateless mode calls this per-request (SDK forbids reconnecting one Server to a
  // new transport while a previous transport is still attached).
  // Stateful mode calls this once and reuses the same server across sessions.
  function setupServer(): McpServer {
    const srv = new McpServer({ name, version }, { capabilities: { tools: {} } });

    srv.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const result: { tools: unknown[]; _meta?: Record<string, unknown> } = {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };
      if (options.toolsListCache) {
        result._meta = {
          ttlMs: options.toolsListCache.ttlMs,
          cacheScope: options.toolsListCache.cacheScope,
        };
      }
      return result;
    });

    srv.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const toolName = req.params.name;
      const tool = tools.find((t) => t.name === toolName);

      if (!tool) {
        return {
          content: [{ type: "text" as const, text: `Unknown tool: "${toolName}"` }],
          isError: true,
        };
      }

      const ctx = httpContextStorage.getStore() ?? buildEmptyCtx();
      const rawArgs = (req.params.arguments ?? {}) as Record<string, unknown>;
      const merge = validateAndMergeHeaderParams(
        tool.inputSchema as unknown as Record<string, unknown>,
        rawArgs,
        ctx.headers,
      );
      // Defensive fallback: the outer POST pipeline already rejects mismatches,
      // but if validation slipped through (e.g. GET/SSE path or missing context),
      // surface the error as a non-throwing tool result.
      if (!merge.ok) {
        return {
          content: [{ type: "text" as const, text: merge.detail }],
          isError: true,
        };
      }

      return onToolCall(tool, merge.args, ctx);
    });

    return srv;
  }

  // Stateful: one shared server; stateless: per-request server from setupServer().
  const statefulServer = session === "stateful" ? setupServer() : null;

  // Stateful mode: session map keeps transports alive between requests.
  // Stateless mode: new server+transport per request.
  const sessionMap = new Map<string, StreamableHTTPServerTransport>();
  let closed = false;

  async function makeTransport(): Promise<StreamableHTTPServerTransport> {
    const srv = session === "stateful" ? statefulServer! : setupServer();
    const t = new StreamableHTTPServerTransport({
      sessionIdGenerator: session === "stateful" ? (sessionIdGenerator ?? randomUUID) : undefined,
      enableJsonResponse,
    });
    await srv.connect(t);
    return t;
  }

  const handleNodeRequest = async (req: McpIncomingMessage, res: ServerResponse): Promise<void> => {
    if (closed) {
      replyJson(res, 503, { error: "server-closed" });
      return;
    }

    // 1. Origin guard
    const originResult = checkOrigin(req.headers["origin"] as string | undefined, allowedOrigins);
    if (!originResult.ok) {
      replyJson(res, 403, { error: "forbidden" });
      return;
    }

    let transport: StreamableHTTPServerTransport;

    if (session === "stateful") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId) {
        const existing = sessionMap.get(sessionId);
        if (!existing) {
          replyJson(res, 404, { error: "session-not-found" });
          return;
        }
        transport = existing;
      } else {
        // New session (initialize)
        transport = await makeTransport();
        // Register cleanup when the transport closes
        const origOnClose = transport.onclose;
        transport.onclose = () => {
          for (const [id, t] of sessionMap) {
            if (t === transport) sessionMap.delete(id);
          }
          origOnClose?.();
        };
      }
    } else {
      // Stateless: fresh transport per request
      transport = await makeTransport();
    }

    // 2. SEP-2243 validation (POST only, when opt-in)
    if (req.method === "POST") {
      if (requireSep2243) {
        const sep2243Result = validateSep2243(
          req.headers as Record<string, string | string[] | undefined>,
          req.body,
        );
        if (!sep2243Result.ok) {
          if (session === "stateless") {
            transport.close().catch(() => {});
          }
          replyHeaderMismatch(
            res,
            req.body,
            sep2243Result.detail ?? sep2243Result.reason ?? "Validation failed",
          );
          return;
        }
      }

      const mcpMethod = (req.headers["mcp-method"] as string) ?? "";
      const mcpName = (req.headers["mcp-name"] as string) ?? "";

      // SEP-2243 Mcp-Param-* coherence check (only for tools/call with a known tool).
      // Fails fast with JSON-RPC -32001 / HTTP 400 before dispatching into the SDK.
      const headerParams: Record<string, string> = {};
      if (mcpMethod === "tools/call" && mcpName) {
        const tool = tools.find((t) => t.name === mcpName);
        if (tool) {
          const args =
            (req.body as { params?: { arguments?: Record<string, unknown> } } | null)?.params
              ?.arguments ?? {};
          const merge = validateAndMergeHeaderParams(
            tool.inputSchema as unknown as Record<string, unknown>,
            args,
            req.headers as Record<string, string | string[] | undefined>,
          );
          if (!merge.ok) {
            if (session === "stateless") {
              transport.close().catch(() => {});
            }
            replyHeaderMismatch(res, req.body, merge.detail);
            return;
          }
          // Collect props whose value came from a header (not the body) so callbacks
          // can distinguish header-injected from body-supplied params.
          for (const [k, v] of Object.entries(merge.args)) {
            if (typeof v === "string" && !Object.prototype.hasOwnProperty.call(args, k)) {
              headerParams[k] = v;
            }
          }
        }
      }

      const ctx: McpHttpContext = {
        headers: req.headers as Record<string, string | string[] | undefined>,
        auth: req.auth,
        mcp: { method: mcpMethod, name: mcpName },
        headerParams,
        traceContext: extractTraceContext(
          req.headers as Record<string, string | string[] | undefined>,
        ),
      };

      if (session === "stateful" && !req.headers["mcp-session-id"]) {
        // After initialize, capture the session ID from the response header
        const origWriteHead = res.writeHead.bind(res);
        (res as unknown as Record<string, unknown>)["writeHead"] = (
          statusCode: number,
          reasonOrHeaders?: unknown,
          headers?: unknown,
        ) => {
          // Extract session id that the SDK injects into the response
          const resolvedHeaders =
            typeof reasonOrHeaders === "object" && reasonOrHeaders !== null
              ? (reasonOrHeaders as Record<string, string>)
              : typeof headers === "object" && headers !== null
                ? (headers as Record<string, string>)
                : {};
          const sid = resolvedHeaders["mcp-session-id"];
          if (sid && typeof sid === "string") {
            sessionMap.set(sid, transport);
          }
          return origWriteHead(
            statusCode,
            reasonOrHeaders as string,
            headers as Record<string, string>,
          );
        };
      }

      await httpContextStorage.run(ctx, () =>
        transport.handleRequest(
          req as Parameters<typeof transport.handleRequest>[0],
          res,
          req.body,
        ),
      );

      if (session === "stateless") {
        res.on("finish", () => {
          transport.close().catch(() => {});
        });
      }
    } else {
      // GET / DELETE: no body, no SEP-2243 check
      const ctx: McpHttpContext = {
        headers: req.headers as Record<string, string | string[] | undefined>,
        auth: req.auth,
        mcp: { method: "", name: "" },
        headerParams: {},
        traceContext: extractTraceContext(
          req.headers as Record<string, string | string[] | undefined>,
        ),
      };

      await httpContextStorage.run(ctx, () =>
        transport.handleRequest(
          req as Parameters<typeof transport.handleRequest>[0],
          res,
          undefined,
        ),
      );

      if (session === "stateless") {
        res.on("finish", () => {
          transport.close().catch(() => {});
        });
      }
    }
  };

  return {
    handleNodeRequest,
    async close() {
      closed = true;
      await statefulServer?.close();
      for (const t of sessionMap.values()) {
        await t.close().catch(() => {});
      }
      sessionMap.clear();
    },
  };
}
