import type { MCPToolInputSchema, ParamOrigin, RouteSchema } from "./types.js";

export interface BuiltToolSchema {
  inputSchema: MCPToolInputSchema;
  paramMap: Record<string, ParamOrigin>;
}

export function buildToolSchema(routeSchema?: RouteSchema): BuiltToolSchema {
  const out: MCPToolInputSchema = { type: "object", properties: {} };
  const required: string[] = [];
  const paramMap: Record<string, ParamOrigin> = {};

  if (!routeSchema) return { inputSchema: out, paramMap };

  for (const source of ["params", "querystring", "body"] as const) {
    const sub = routeSchema[source];
    if (!sub) continue;

    // If the sub-schema is NOT a JSON Schema object (type !== "object"),
    // wrap it entirely under the `source` key (e.g. body: { type: "string" })
    if ((sub as { type?: string }).type !== "object") {
      out.properties[source] = sub;
      paramMap[source] = source;
      continue;
    }

    // It's an object schema — merge its properties into the flat output
    const subObj = sub as {
      type: "object";
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const subProperties = subObj.properties ?? {};
    const subRequired = subObj.required ?? [];

    for (const [key, propSchema] of Object.entries(subProperties)) {
      // Check if $ref present — skip it with a warning to stderr
      if (typeof propSchema === "object" && propSchema !== null && "$ref" in propSchema) {
        process.stderr.write(
          `[mcp-auto-expose] skipping property "${key}" from "${source}" — $ref not supported in MVP\n`,
        );
        continue;
      }

      // Handle key collision
      const finalKey = key in out.properties ? renameOnCollision(key, source) : key;

      out.properties[finalKey] = propSchema;
      paramMap[finalKey] = source;
      if (subRequired.includes(key)) {
        required.push(finalKey);
      }
    }
  }

  if (required.length > 0) out.required = required;
  return { inputSchema: out, paramMap };
}

export function flattenSchema(routeSchema?: RouteSchema): MCPToolInputSchema {
  return buildToolSchema(routeSchema).inputSchema;
}

export function renameOnCollision(key: string, source: string): string {
  const newKey = `${source}_${key}`;
  process.stderr.write(
    `[mcp-auto-expose] key collision "${key}" from "${source}" — renamed to "${newKey}"\n`,
  );
  return newKey;
}
