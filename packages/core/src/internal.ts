/**
 * Re-exports INTERNAL_SOURCE and InternalSource from types.ts.
 * These are the canonical definitions — co-located with MCPTool so that
 * TypeScript declaration emit works correctly for the symbol-keyed property.
 *
 * External packages import from "@mcp-auto-expose/core/internal" to get these.
 */
export { INTERNAL_SOURCE, type InternalSource } from "./types.js";
