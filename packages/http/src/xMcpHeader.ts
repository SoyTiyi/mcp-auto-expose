import { warn as defaultWarn } from "./warn.js";

const PRIMITIVE_TYPES = new Set(["string", "number", "boolean", "integer"]);

export function isValidXMcpHeaderName(name: unknown): name is string {
  if (typeof name !== "string" || name.length === 0) return false;
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code <= 0x20 || code === 0x3a || code >= 0x7f) return false;
  }
  return true;
}

export function sanitizeToolXMcpHeaders(
  toolName: string,
  inputSchema: Record<string, unknown>,
  warnFn: (code: string, detail?: unknown) => void = defaultWarn,
): void {
  const properties = inputSchema["properties"] as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!properties) return;

  const seenLower = new Map<string, string>();

  for (const [propKey, prop] of Object.entries(properties)) {
    if (!("x-mcp-header" in prop)) continue;
    const annotation = prop["x-mcp-header"];

    if (!isValidXMcpHeaderName(annotation)) {
      warnFn("xmcpheader-invalid-name", { tool: toolName, prop: propKey, value: annotation });
      delete prop["x-mcp-header"];
      continue;
    }

    const propType = prop["type"];
    if (typeof propType !== "string" || !PRIMITIVE_TYPES.has(propType)) {
      warnFn("xmcpheader-non-primitive", { tool: toolName, prop: propKey, type: propType });
      delete prop["x-mcp-header"];
      continue;
    }

    const lower = (annotation as string).toLowerCase();
    const prev = seenLower.get(lower);
    if (prev !== undefined) {
      warnFn("xmcpheader-duplicate", {
        tool: toolName,
        prop: propKey,
        previousProp: prev,
        name: annotation,
      });
      delete prop["x-mcp-header"];
      continue;
    }
    seenLower.set(lower, propKey);
  }
}
