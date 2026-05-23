// mcpHeader marks a Zod schema to indicate this parameter can also be transmitted
// via HTTP header Mcp-Param-<KebabCase(fieldName)>.
//
// For Fastify, this is a no-op marker (Fastify uses plain JSON Schema, not Zod).
// The helper exists for API symmetry and to support a future Fastify+Zod integration.

const mcpHeaderSet = new WeakSet<object>();

export function mcpHeader<T extends object>(schema: T): T {
  mcpHeaderSet.add(schema);
  return schema;
}

export function isMcpHeader(schema: object): boolean {
  return mcpHeaderSet.has(schema);
}
