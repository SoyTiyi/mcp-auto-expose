import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod/v3";
import type { RouteSchema } from "@mcp-auto-expose/core";
import { warn } from "./warn.js";

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

  conversionCache.set(schema, out);
  return out;
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
