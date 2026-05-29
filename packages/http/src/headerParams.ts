/**
 * Re-exports from @mcp-auto-expose/core.
 *
 * The Mcp-Param-* header encode/decode/validate logic is part of the MCP protocol layer
 * and lives in core. This file exists for backward compatibility.
 */
export {
  encodeHeaderValue,
  decodeHeaderValue,
  collectExpectedHeaderParams,
  validateAndMergeHeaderParams,
  MCP_PARAM_PREFIX,
} from "@mcp-auto-expose/core";
export type { ValidateResult, ValidateFail, ValidateOk, DecodeResult, DecodeOk, DecodeFail } from "@mcp-auto-expose/core";
