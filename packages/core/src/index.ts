export type {
  HTTPMethod,
  MCPToolInputSchema,
  ParamOrigin,
  RouteSchema,
  RouteDescriptor,
  MCPTool,
} from "./types.js";

export { resolveTool } from "./resolveTool.js";
export { ToolRegistry } from "./registry.js";

export { flattenSchema, buildToolSchema, renameOnCollision } from "./flattenSchema.js";
export type { BuiltToolSchema } from "./flattenSchema.js";

export { reconstructRequest, toMcpParamHeader } from "./reconstructRequest.js";
export type { ReconstructedRequest } from "./reconstructRequest.js";

export { makeHttpCaller } from "./httpCaller.js";
export type { OnToolCall, CallToolResult, HttpCallerOptions } from "./httpCaller.js";
