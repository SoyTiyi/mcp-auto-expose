import { Router } from "express";
import type { RequestHandler } from "express";
import { createMcpHttp } from "./createMcpHttp.js";
import type { McpHttpOptions, McpIncomingMessage } from "./createMcpHttp.js";

export interface MountMcpExpressResult {
  middleware: RequestHandler;
  router: Router;
  close(): Promise<void>;
}

export function mountMcpExpress(opts: McpHttpOptions): MountMcpExpressResult {
  const path = opts.path ?? "/mcp";
  const handle = createMcpHttp(opts);

  const handler: RequestHandler = (req, res, next) => {
    handle.handleNodeRequest(req as McpIncomingMessage, res).catch(next);
  };

  const router = Router();
  router.post(path, handler);
  router.get(path, handler);
  router.delete(path, handler);

  return {
    middleware: handler,
    router,
    async close() {
      await handle.close();
    },
  };
}
