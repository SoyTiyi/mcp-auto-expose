import type { MCPTool, RouteDescriptor } from "./types.js";
import { INTERNAL_SOURCE } from "./internal.js";
import { generateToolName } from "./toolName.js";
import { buildToolSchema } from "./flattenSchema.js";

export function resolveTool(descriptor: RouteDescriptor): MCPTool {
  const { framework, method, url, schema } = descriptor;

  const description: string =
    schema?.description ??
    schema?.summary ??
    `${method} ${url} — auto-descubierto por mcp-auto-expose`;

  const { inputSchema, paramMap } = buildToolSchema(schema);

  return {
    name: generateToolName(method, url),
    description,
    inputSchema,
    [INTERNAL_SOURCE]: { framework, method, url, paramMap },
  };
}
