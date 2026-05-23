import { warn as defaultWarn } from "./warn.js";

const MCP_PARAM_PREFIX = "mcp-param-";

/**
 * Converts snake_case to Title-Kebab-Case for header names.
 * e.g. "tenant_id" → "Tenant-Id"
 * e.g. "invoice_external_ref" → "Invoice-External-Ref"
 */
export function kebabize(snake: string): string {
  return snake
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

/**
 * Converts "mcp-param-tenant-id" → "tenant_id".
 * Strips the "mcp-param-" prefix, lowercases, replaces "-" with "_".
 */
export function unkebabize(mcpParamHeader: string): string {
  return mcpParamHeader.slice(MCP_PARAM_PREFIX.length).replace(/-/g, "_");
}

/**
 * From a normalized headers map (lowercase keys), extract all headers
 * prefixed with "mcp-param-" and return them as { snake_case_key: value }.
 */
export function extractHeaderParams(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!key.startsWith(MCP_PARAM_PREFIX)) continue;
    if (value === undefined) continue;
    const snakeKey = unkebabize(key);
    result[snakeKey] = Array.isArray(value) ? value[0]! : value;
  }
  return result;
}

/**
 * Given a JSON Schema (output of zodToJsonSchema) and the current args from the
 * JSON-RPC body, produce merged args that incorporate header params.
 *
 * For each property in jsonSchema.properties that has `"x-mcp-header": true`:
 *   - If the key exists in headerParams AND in args AND they differ → use header value + warn
 *   - If only in headerParams → inject into args
 *   - If only in args → keep args value
 * Returns new args object (does not mutate input).
 */
export function mergeHeaderParams(
  jsonSchema: Record<string, unknown>,
  args: Record<string, unknown>,
  headerParams: Record<string, string>,
  warnFn: (code: string, detail?: unknown) => void = defaultWarn,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...args };

  const properties = jsonSchema["properties"] as Record<string, Record<string, unknown>> | undefined;
  if (!properties) return merged;

  for (const [key, propSchema] of Object.entries(properties)) {
    if (!propSchema["x-mcp-header"]) continue;

    const inHeader = Object.prototype.hasOwnProperty.call(headerParams, key);
    const inArgs = Object.prototype.hasOwnProperty.call(args, key);

    if (!inHeader) continue;

    if (inArgs && args[key] !== headerParams[key]) {
      warnFn("header-body-mismatch", { key, argsValue: args[key], headerValue: headerParams[key] });
    }

    merged[key] = headerParams[key];
  }

  return merged;
}
