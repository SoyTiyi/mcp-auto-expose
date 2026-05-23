import type { RouteOptions } from "fastify";
import type { RouteDescriptor, HTTPMethod, RouteSchema } from "@mcp-auto-expose/core";

export interface AutoExposeOptions {
  strictSchema?: boolean;
}

// Valid HTTP methods we support
const SUPPORTED_METHODS = new Set<string>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

export function adaptRouteOptions(
  routeOptions: RouteOptions,
  pluginOptions: AutoExposeOptions = {},
): RouteDescriptor[] {
  const rawMethods = Array.isArray(routeOptions.method)
    ? routeOptions.method
    : [routeOptions.method];

  const schema = routeOptions.schema as
    | {
        body?: Record<string, unknown>;
        querystring?: Record<string, unknown>;
        params?: Record<string, unknown>;
        description?: string;
        summary?: string;
        tags?: string[];
        hide?: boolean;
        [key: string]: unknown;
      }
    | undefined;

  // Skip if hide
  if (schema?.hide === true) return [];

  // Skip if explicitly opted out
  if (
    (routeOptions.config as { mcpExpose?: boolean } | undefined)?.mcpExpose === false
  ) {
    return [];
  }

  // Check if has input schema
  const hasInputSchema = Boolean(
    schema?.body ?? schema?.querystring ?? schema?.params,
  );

  if (pluginOptions.strictSchema && !hasInputSchema) return [];

  const routeSchema: RouteSchema | undefined = schema
    ? {
        body: schema.body,
        querystring: schema.querystring,
        params: schema.params,
        description: schema.description,
        summary: schema.summary,
        tags: schema.tags,
        hide: schema.hide,
      }
    : undefined;

  const descriptors: RouteDescriptor[] = [];

  for (const method of rawMethods) {
    if (!SUPPORTED_METHODS.has(method)) continue;
    descriptors.push({
      framework: "fastify",
      method: method as HTTPMethod,
      url: routeOptions.url,
      schema: routeSchema,
    });
  }

  return descriptors;
}
