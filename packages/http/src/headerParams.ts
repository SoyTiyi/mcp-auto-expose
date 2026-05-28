const MCP_PARAM_PREFIX = "mcp-param-";

export interface ValidateOk {
  ok: true;
  args: Record<string, unknown>;
}
export interface ValidateFail {
  ok: false;
  reason: "header-missing" | "header-mismatch" | "invalid-base64";
  detail: string;
}
export type ValidateResult = ValidateOk | ValidateFail;

export interface DecodeOk {
  ok: true;
  value: string;
}
export interface DecodeFail {
  ok: false;
  reason: "invalid-base64";
}
export type DecodeResult = DecodeOk | DecodeFail;

function needsEncoding(value: string): boolean {
  if (value.length === 0) return false;
  const first = value.charCodeAt(0);
  const last = value.charCodeAt(value.length - 1);
  if (first === 0x20 || first === 0x09) return true;
  if (last === 0x20 || last === 0x09) return true;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || c > 0x7e) return true;
  }
  return false;
}

export function encodeHeaderValue(value: string): string {
  if (!needsEncoding(value)) return value;
  const b64 = Buffer.from(value, "utf8").toString("base64");
  return `=?base64?${b64}?=`;
}

export function decodeHeaderValue(value: string): DecodeResult {
  const lowerValue = value.toLowerCase();
  if (!lowerValue.startsWith("=?base64?") || !value.endsWith("?=")) {
    return { ok: true, value };
  }
  const inner = value.slice("=?base64?".length, value.length - "?=".length);
  try {
    const decoded = Buffer.from(inner, "base64");
    if (decoded.toString("base64") !== inner) {
      return { ok: false, reason: "invalid-base64" };
    }
    return { ok: true, value: decoded.toString("utf8") };
  } catch {
    return { ok: false, reason: "invalid-base64" };
  }
}

/**
 * Walks inputSchema.properties and builds a map of
 * { "mcp-param-<lowercase-name>": "<propKey>" }
 * for every property carrying a valid x-mcp-header string.
 */
export function collectExpectedHeaderParams(
  inputSchema: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const properties = inputSchema["properties"] as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!properties) return out;
  for (const [propKey, prop] of Object.entries(properties)) {
    const name = prop["x-mcp-header"];
    if (typeof name !== "string" || name.length === 0) continue;
    out[`${MCP_PARAM_PREFIX}${name.toLowerCase()}`] = propKey;
  }
  return out;
}

function valueToString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : undefined;
  if (typeof v === "boolean") return v ? "true" : "false";
  return undefined;
}

/**
 * Validates SEP-2243 Mcp-Param-* coherence against body args and merges values.
 *
 * For each property in inputSchema with a valid x-mcp-header string Name:
 *  - If body args contain a value but no Mcp-Param-Name header → header-missing.
 *  - If body args and header are both present and disagree (after Base64 decode) → header-mismatch.
 *  - If header is encoded with an invalid Base64 sentinel → invalid-base64.
 *  - If body arg is absent and header is present → inject header value into args.
 */
export function validateAndMergeHeaderParams(
  inputSchema: Record<string, unknown>,
  args: Record<string, unknown>,
  headers: Record<string, string | string[] | undefined>,
): ValidateResult {
  const merged: Record<string, unknown> = { ...args };
  const properties = inputSchema["properties"] as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!properties) return { ok: true, args: merged };

  for (const [propKey, prop] of Object.entries(properties)) {
    const name = prop["x-mcp-header"];
    if (typeof name !== "string" || name.length === 0) continue;

    const headerKey = `${MCP_PARAM_PREFIX}${(name as string).toLowerCase()}`;
    const rawHeader = headers[headerKey];
    const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    const inArgs =
      Object.prototype.hasOwnProperty.call(args, propKey) &&
      args[propKey] !== undefined &&
      args[propKey] !== null;
    const bodyAsString = inArgs ? valueToString(args[propKey]) : undefined;

    if (headerValue === undefined) {
      if (inArgs) {
        return {
          ok: false,
          reason: "header-missing",
          detail: `Mcp-Param-${name} header is required because body argument '${propKey}' is present`,
        };
      }
      continue;
    }

    const decoded = decodeHeaderValue(headerValue);
    if (!decoded.ok) {
      return {
        ok: false,
        reason: "invalid-base64",
        detail: `Mcp-Param-${name} value is not valid Base64 inside the =?base64?...?= sentinel`,
      };
    }

    if (inArgs && bodyAsString !== undefined && bodyAsString !== decoded.value) {
      return {
        ok: false,
        reason: "header-mismatch",
        detail: `Mcp-Param-${name} value does not match body argument '${propKey}'`,
      };
    }

    merged[propKey] = decoded.value;
  }

  return { ok: true, args: merged };
}
