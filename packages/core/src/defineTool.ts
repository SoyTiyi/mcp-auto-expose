import { z } from "zod";
import { INTERNAL_SOURCE } from "./internal.js";
import type { MCPTool, MCPToolInputSchema, ToolCallResult } from "./types.js";

export interface ToolDefinition<T extends z.ZodObject<z.ZodRawShape>> {
  name: string;
  description: string;
  inputSchema: T;
  execute(args: z.infer<T>): Promise<ToolCallResult> | ToolCallResult;
}

/**
 * Creates an MCPTool from a Zod schema + execute handler, without registering an HTTP route.
 *
 * The tool's execute callback is invoked directly (in-process) by the MCP transport layer,
 * with no HTTP roundtrip. This is the escape hatch for tools that don't map 1:1 to HTTP routes.
 *
 * @example
 * ```ts
 * const pingTool = defineTool({
 *   name: "ping",
 *   description: "Returns pong",
 *   inputSchema: z.object({}),
 *   execute: async () => ({ content: [{ type: "text", text: "pong" }] }),
 * });
 * ```
 */
export function defineTool<T extends z.ZodObject<z.ZodRawShape>>(def: ToolDefinition<T>): MCPTool {
  // Build JSON Schema from the Zod object — same pattern as packages/express/src/zodConvert.ts
  let jsonSchema: Record<string, unknown>;
  try {
    jsonSchema = {
      ...(z.toJSONSchema(def.inputSchema, {
        target: "draft-2020-12",
        reused: "inline",
        unrepresentable: "any",
      }) as Record<string, unknown>),
    };
    delete jsonSchema["~standard"];
  } catch {
    jsonSchema = {};
  }

  const inputSchema: MCPToolInputSchema = {
    type: "object",
    properties: (jsonSchema["properties"] as Record<string, unknown>) ?? {},
    ...(jsonSchema["required"] ? { required: jsonSchema["required"] as string[] } : {}),
  };

  return {
    name: def.name,
    description: def.description,
    inputSchema,
    [INTERNAL_SOURCE]: {
      paramMap: {},
      framework: "manual",
      url: "",
      method: "GET",
      execute: def.execute as (args: unknown) => Promise<ToolCallResult> | ToolCallResult,
    },
  };
}
