import type { z } from "zod";

const mcpHeaderSet = new WeakSet<object>();
const mcpHeaderNames = new WeakMap<object, string>();

export function mcpHeader<T extends z.ZodType>(schema: T, name?: string): T {
  mcpHeaderSet.add(schema as object);
  if (name !== undefined) mcpHeaderNames.set(schema as object, name);
  return schema;
}

export function isMcpHeader(schema: z.ZodType): boolean {
  return mcpHeaderSet.has(schema as object);
}

export function getMcpHeaderName(schema: z.ZodType): string | undefined {
  return mcpHeaderNames.get(schema as object);
}
