import type { RequestHandler, Router } from "express";
import type { McpHttpOptions } from "./createMcpHttp.js";

export interface MountMcpExpressResult {
  middleware: RequestHandler;
  router: Router;
  close(): Promise<void>;
}

export function mountMcpExpress(_opts: McpHttpOptions): MountMcpExpressResult {
  throw new Error("not implemented");
}
