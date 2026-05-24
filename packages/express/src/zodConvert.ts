import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod/v3";
import type { RouteSchema } from "@mcp-auto-expose/core";
import { warn } from "./warn.js";
import { isMcpHeader, getMcpHeaderName } from "./mcpHeader.js";

// McpExposeSpec is defined here; mcpExpose.ts (Task 3) will import it from here.
export interface McpExposeSpec {
  body?: ZodTypeAny;
  query?: ZodTypeAny; // Express idiom → maps to RouteSchema.querystring
  params?: ZodTypeAny;
  description?: string;
  summary?: string;
  tags?: string[];
  hide?: boolean;
}

const conversionCache = new WeakMap<ZodTypeAny, Record<string, unknown>>();

export function convertCached(schema: ZodTypeAny): Record<string, unknown> {
  const cached = conversionCache.get(schema);
  if (cached) return cached;

  let out: Record<string, unknown>;
  try {
    out = zodToJsonSchema(schema, {
      target: "jsonSchema7",
      $refStrategy: "none",
    }) as Record<string, unknown>;
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
    const def = (schema as unknown as { _def?: { typeName?: string; shape?: () => Record<string, ZodTypeAny> } })._def;
    if (def?.typeName === "ZodObject" && typeof def.shape === "function") {
      const properties = out["properties"] as Record<string, Record<string, unknown>> | undefined;
      if (properties) {
        for (const [propName, propSchema] of Object.entries(def.shape())) {
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
    .split(/[_\-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function specToRouteSchema(spec: McpExposeSpec): RouteSchema {
  return {
    body: spec.body ? convertCached(spec.body) : undefined,
    querystring: spec.query ? convertCached(spec.query) : undefined,
    params: spec.params ? convertCached(spec.params) : undefined,
    description: spec.description,
    summary: spec.summary,
    tags: spec.tags ? [...spec.tags] : undefined,
    hide: spec.hide,
  };
}
