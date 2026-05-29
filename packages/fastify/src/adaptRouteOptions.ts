import type { RouteOptions } from "fastify";
import type { RouteDescriptor, HTTPMethod, RouteSchema } from "@mcp-auto-expose/core";

export interface AutoExposeOptions {
  strictSchema?: boolean;
  includeHead?: boolean; // default: false — HEAD excluded by default (Fastify auto-generates HEAD for every GET)
}

// HEAD is excluded: Fastify auto-generates a HEAD route for every GET route.
// Including HEAD would produce a duplicate tool (e.g. head_users) alongside list_users.
// OPTIONS is included because users may define explicit OPTIONS handlers for non-CORS purposes.
const SUPPORTED_METHODS = new Set<string>(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

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
  if ((routeOptions.config as { mcpExpose?: boolean } | undefined)?.mcpExpose === false) {
    return [];
  }

  // Check if has input schema
  const hasInputSchema = Boolean(schema?.body ?? schema?.querystring ?? schema?.params);

  if (pluginOptions.strictSchema && !hasInputSchema) return [];

  const routeSchema: RouteSchema | undefined = schema
    ? {
        ...(schema.body !== undefined && { body: schema.body }),
        ...(schema.querystring !== undefined && { querystring: schema.querystring }),
        ...(schema.params !== undefined && { params: schema.params }),
        ...(schema.description !== undefined && { description: schema.description }),
        ...(schema.summary !== undefined && { summary: schema.summary }),
        ...(schema.tags !== undefined && { tags: schema.tags }),
        ...(schema.hide !== undefined && { hide: schema.hide }),
      }
    : undefined;

  const descriptors: RouteDescriptor[] = [];

  for (const method of rawMethods) {
    if (method === "HEAD" && !pluginOptions.includeHead) continue;
    if (!SUPPORTED_METHODS.has(method) && method !== "HEAD") continue;
    descriptors.push({
      framework: "fastify",
      method: method as HTTPMethod,
      url: routeOptions.url,
      ...(routeSchema !== undefined && { schema: routeSchema }),
    });
  }

  return descriptors;
}
