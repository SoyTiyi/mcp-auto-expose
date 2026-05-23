import type { ZodTypeAny } from "zod/v3";

const mcpHeaderSet = new WeakSet<object>();

export function mcpHeader<T extends ZodTypeAny>(schema: T): T {
  mcpHeaderSet.add(schema as object);
  return schema;
}

export function isMcpHeader(schema: ZodTypeAny): boolean {
  return mcpHeaderSet.has(schema as object);
}
