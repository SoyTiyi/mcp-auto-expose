import type { MCPTool } from "./types.js";

export interface ReconstructedRequest {
  url: string;
  querystring: string;
  body: unknown;
  /** Mcp-Param-* headers derived from x-mcp-header args. */
  headers: Record<string, string>;
}

const BODILESS_METHODS = new Set(["GET", "DELETE", "HEAD", "OPTIONS"]);

/**
 * Converts a snake_case key to Title-Kebab-Case for header names.
 * Example: tenant_id → Tenant-Id
 */
export function toMcpParamHeader(key: string): string {
  const titled = key
    .split("_")
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ""))
    .join("-");
  return `Mcp-Param-${titled}`;
}

/**
 * Reconstructs the original REST request fragments from a flat MCP args map.
 * - Uses _source.paramMap to route each arg to params/querystring/body.
 * - Args with x-mcp-header: true are forwarded as Mcp-Param-* headers instead.
 * - URL param substitution uses encodeURIComponent to prevent path injection.
 */
export function reconstructRequest(
  tool: MCPTool,
  args: Record<string, unknown>,
): ReconstructedRequest {
  let url = tool._source.url;
  const qs = new URLSearchParams();
  const bodyObj: Record<string, unknown> = {};
  const headers: Record<string, string> = {};
  const isBodiless = BODILESS_METHODS.has(tool._source.method);

  const properties = tool.inputSchema.properties as Record<string, Record<string, unknown>>;

  for (const [key, origin] of Object.entries(tool._source.paramMap)) {
    if (!(key in args)) continue;
    const value = args[key];

    // x-mcp-header args travel as Mcp-Param-* to the backend
    const annotation = properties[key]?.["x-mcp-header"];
    if (typeof annotation === "string" && annotation.length > 0) {
      headers[`Mcp-Param-${annotation}`] = String(value);
      continue;
    }

    if (origin === "params") {
      const colonPlaceholder = `:${key}`;
      const bracePlaceholder = `{${key}}`;
      if (url.includes(colonPlaceholder)) {
        url = url.replace(colonPlaceholder, encodeURIComponent(String(value)));
      } else if (url.includes(bracePlaceholder)) {
        url = url.replace(bracePlaceholder, encodeURIComponent(String(value)));
      } else {
        process.stderr.write(
          `[mcp-auto-expose] unbound-param: key "${key}" has no :${key} placeholder in url "${tool._source.url}" — skipping\n`,
        );
      }
    } else if (origin === "querystring") {
      qs.set(key, String(value));
    } else if (origin === "body") {
      if (isBodiless) {
        process.stderr.write(
          `[mcp-auto-expose] body-on-bodiless-method: key "${key}" declared as body but method is ${tool._source.method} — skipping\n`,
        );
      } else {
        bodyObj[key] = value;
      }
    }
  }

  const querystring = qs.size > 0 ? `?${qs.toString()}` : "";
  const body = isBodiless ? undefined : Object.keys(bodyObj).length > 0 ? bodyObj : undefined;

  return { url, querystring, body, headers };
}
