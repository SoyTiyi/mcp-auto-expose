import type { MCPTool, RouteDescriptor } from "./types.js";
import { generateToolName } from "./toolName.js";
import { flattenSchema } from "./flattenSchema.js";

export function resolveTool(descriptor: RouteDescriptor): MCPTool {
  const { framework, method, url, schema } = descriptor;

  const description: string =
    schema?.description ??
    schema?.summary ??
    `${method} ${url} — auto-descubierto por mcp-auto-expose`;

  return {
    name: generateToolName(method, url),
    description,
    inputSchema: flattenSchema(schema),
    _source: { framework, method, url },
  };
}
