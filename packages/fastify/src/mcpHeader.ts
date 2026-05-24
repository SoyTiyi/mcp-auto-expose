// mcpHeader stamps the SEP-2243 `x-mcp-header` annotation onto a Fastify JSON Schema
// property object. Fastify users compose plain JSON Schema (not Zod), so this helper
// performs the stamping inline — no marker WeakSet needed.
//
// Usage:
//   params: {
//     type: "object",
//     properties: {
//       tenant_id: mcpHeader({ type: "string" }, "TenantId"),
//     },
//   }
//
// Produces Mcp-Param-TenantId on the wire (verbatim, no transformation).

export function mcpHeader<T extends Record<string, unknown>>(
  schema: T,
  name: string,
): T & { "x-mcp-header": string } {
  return { ...schema, "x-mcp-header": name };
}
