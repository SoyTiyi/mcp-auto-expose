import type { ZodTypeAny } from "zod/v3";

const mcpHeaderSet = new WeakSet<object>();
const mcpHeaderNames = new WeakMap<object, string>();

export function mcpHeader<T extends ZodTypeAny>(schema: T, name?: string): T {
  mcpHeaderSet.add(schema as object);
  if (name !== undefined) mcpHeaderNames.set(schema as object, name);
  return schema;
}

export function isMcpHeader(schema: ZodTypeAny): boolean {
  return mcpHeaderSet.has(schema as object);
}

export function getMcpHeaderName(schema: ZodTypeAny): string | undefined {
  return mcpHeaderNames.get(schema as object);
}
