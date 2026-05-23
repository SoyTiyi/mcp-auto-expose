import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { MCPTool } from "@mcp-auto-expose/core";
import { checkOrigin } from "./origin.js";
import { validateSep2243 } from "./sep2243.js";
import { extractHeaderParams, mergeHeaderParams } from "./headerParams.js";
import { localhostWarn } from "./localhostWarn.js";
import { warn } from "./warn.js";

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

function buildEmptyCtx(): McpHttpContext {
  return { headers: {}, mcp: { method: "", name: "" }, headerParams: {} };
}

function replyJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
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
    onToolCall,
  } = options;

  localhostWarn(warnOnNonLocalhost);

  const httpContextStorage = new AsyncLocalStorage<McpHttpContext>();

  // Creates a new Server instance with all handlers registered.
  // Stateless mode calls this per-request (SDK forbids reconnecting one Server to a
  // new transport while a previous transport is still attached).
  // Stateful mode calls this once and reuses the same server across sessions.
  function setupServer(): Server {
    const srv = new Server({ name, version }, { capabilities: { tools: {} } });

    srv.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }));

    srv.setRequestHandler(CallToolRequestSchema, async (req) => {
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
      const enrichedArgs = mergeHeaderParams(tool.inputSchema, rawArgs, ctx.headerParams, warn);

      return onToolCall(tool, enrichedArgs, ctx);
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
      sessionIdGenerator:
        session === "stateful" ? (sessionIdGenerator ?? randomUUID) : undefined,
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
    const originResult = checkOrigin(
      req.headers["origin"] as string | undefined,
      allowedOrigins,
    );
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

    // 2. SEP-2243 validation (POST only)
    if (req.method === "POST") {
      const sep2243Result = validateSep2243(
        req.headers as Record<string, string | string[] | undefined>,
        req.body,
      );
      if (!sep2243Result.ok) {
        if (session === "stateless") {
          transport.close().catch(() => {});
        }
        replyJson(res, 400, { error: sep2243Result.reason });
        return;
      }

      const mcpMethod = sep2243Result.mcp?.method ?? "";
      const mcpName = sep2243Result.mcp?.name ?? "";
      const headerParams = extractHeaderParams(
        req.headers as Record<string, string | string[] | undefined>,
      );

      const ctx: McpHttpContext = {
        headers: req.headers as Record<string, string | string[] | undefined>,
        auth: req.auth,
        mcp: { method: mcpMethod, name: mcpName },
        headerParams,
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
          return origWriteHead(statusCode, reasonOrHeaders as string, headers as Record<string, string>);
        };
      }

      await httpContextStorage.run(ctx, () =>
        transport.handleRequest(req, res, req.body),
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
      };

      await httpContextStorage.run(ctx, () =>
        transport.handleRequest(req, res, undefined),
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
