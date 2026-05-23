import type { RequestHandler } from "express";
import type { RouteSchema } from "@mcp-auto-expose/core";
import { specToRouteSchema } from "./zodConvert.js";
import type { McpExposeSpec } from "./zodConvert.js";

export type { McpExposeSpec } from "./zodConvert.js"; // re-export for consumers

export const MCP_EXPOSE_SYMBOL: unique symbol = Symbol.for("mcp-auto-expose.schema");

export function mcpExpose(spec: McpExposeSpec): RequestHandler {
  const routeSchema = specToRouteSchema(spec);
  const middleware: RequestHandler = (_req, _res, next) => next();
  (middleware as unknown as Record<symbol, RouteSchema>)[MCP_EXPOSE_SYMBOL] = routeSchema;
  return middleware;
}
