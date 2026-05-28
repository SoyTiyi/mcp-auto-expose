export interface Sep2243Outcome {
  ok: boolean;
  reason?: "missing-header" | "method-mismatch" | "name-mismatch" | "malformed-body";
  detail?: string;
  mcp?: { method: string; name: string };
}

function firstString(value: string | string[] | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value[0] ?? undefined;
  return value || undefined;
}

export function validateSep2243(
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
): Sep2243Outcome {
  // Rule 1: body must be an object with a string `.method`
  if (
    body === null ||
    typeof body !== "object" ||
    typeof (body as Record<string, unknown>)["method"] !== "string"
  ) {
    return {
      ok: false,
      reason: "malformed-body",
      detail: "JSON-RPC body must be an object with a string 'method' field",
    };
  }

  const bodyMethod = (body as Record<string, unknown>)["method"] as string;

  // Rule 2: mcp-method header must be present and non-empty
  const mcpMethod = firstString(headers["mcp-method"]);
  if (mcpMethod === undefined) {
    return {
      ok: false,
      reason: "missing-header",
      detail: "Mcp-Method header is required for POST requests",
    };
  }

  // Rule 3: mcp-method must match body.method (case-sensitive)
  if (mcpMethod !== bodyMethod) {
    return {
      ok: false,
      reason: "method-mismatch",
      detail: `Mcp-Method header value '${mcpMethod}' does not match body method '${bodyMethod}'`,
    };
  }

  // Rules 4-6: tools/call requires mcp-name matching body.params.name
  if (bodyMethod === "tools/call") {
    const mcpName = firstString(headers["mcp-name"]);
    if (mcpName === undefined) {
      return {
        ok: false,
        reason: "missing-header",
        detail: "Mcp-Name header is required for tools/call",
      };
    }

    const params = (body as Record<string, unknown>)["params"];
    const bodyName =
      params !== null && typeof params === "object"
        ? ((params as Record<string, unknown>)["name"] as string | undefined)
        : undefined;

    if (mcpName !== bodyName) {
      return {
        ok: false,
        reason: "name-mismatch",
        detail: `Mcp-Name header value '${mcpName}' does not match body params.name '${bodyName ?? ""}'`,
      };
    }

    return { ok: true, mcp: { method: "tools/call", name: mcpName } };
  }

  // Rules 7-9: all other methods just need matching mcp-method, no mcp-name required
  return { ok: true, mcp: { method: bodyMethod, name: "" } };
}
