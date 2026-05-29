import { z } from "zod";
import type { RouteSchema } from "@mcp-auto-expose/core";
import { warn } from "./warn.js";
import { isMcpHeader, getMcpHeaderName } from "./mcpHeader.js";

// McpExposeSpec is defined here; mcpExpose.ts re-exports it for consumers.
export interface McpExposeSpec {
  body?: z.ZodType;
  query?: z.ZodType; // Express idiom → maps to RouteSchema.querystring
  params?: z.ZodType;
  description?: string;
  summary?: string;
  tags?: string[];
  hide?: boolean;
}

const conversionCache = new WeakMap<z.ZodType, Record<string, unknown>>();

export function convertCached(schema: z.ZodType): Record<string, unknown> {
  const cached = conversionCache.get(schema);
  if (cached) return cached;

  let out: Record<string, unknown>;
  try {
    out = {
      ...(z.toJSONSchema(schema, {
        target: "draft-2020-12",
        reused: "inline",
        unrepresentable: "any",
      }) as Record<string, unknown>),
    };
    // Remove Standard Schema marker — not part of the JSON Schema output
    delete out["~standard"];
  } catch (e) {
    warn("zod-convert-failed", { message: String(e) });
    out = {};
  }

  if (JSON.stringify(out).includes('"$ref"')) {
    warn("schema-has-ref", {
      hint: "use flat z.object; recursive schemas become {}",
    });
  }

  // Inject "x-mcp-header": <name> on properties marked with mcpHeader()
  // Per SEP-2243 Final: value is a non-empty ASCII string used verbatim as the
  // Mcp-Param-{name} segment. Falls back to PascalCase of the property key.
  try {
    if (schema instanceof z.ZodObject) {
      const properties = out["properties"] as Record<string, Record<string, unknown>> | undefined;
      if (properties) {
        for (const [propName, propSchema] of Object.entries(
          schema.shape as Record<string, z.ZodType>,
        )) {
          if (!isMcpHeader(propSchema)) continue;
          if (!properties[propName]) continue;
          const explicit = getMcpHeaderName(propSchema);
          properties[propName]["x-mcp-header"] = explicit ?? toPascalCase(propName);
        }
      }
    }
  } catch {
    // Guard: non-critical annotation injection — skip silently if anything fails
  }

  conversionCache.set(schema, out);
  return out;
}

function toPascalCase(snake: string): string {
  return snake
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function specToRouteSchema(spec: McpExposeSpec): RouteSchema {
  return {
    ...(spec.body && { body: convertCached(spec.body) }),
    ...(spec.query && { querystring: convertCached(spec.query) }),
    ...(spec.params && { params: convertCached(spec.params) }),
    ...(spec.description !== undefined && { description: spec.description }),
    ...(spec.summary !== undefined && { summary: spec.summary }),
    ...(spec.tags !== undefined && { tags: [...spec.tags] }),
    ...(spec.hide !== undefined && { hide: spec.hide }),
  };
}
