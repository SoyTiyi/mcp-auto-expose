import { warn } from "./warn.js";

export function checkOrigin(
  originHeader: string | undefined,
  allowedOrigins: string[],
): { ok: true } | { ok: false; status: 403; reason: string } {
  if (originHeader === undefined) {
    if (allowedOrigins.length === 0) {
      warn("absent-origin-empty-whitelist", "no Origin header and no whitelist configured");
    }
    return { ok: true };
  }

  if (allowedOrigins.length === 0) {
    return { ok: false, status: 403, reason: "no-whitelist" };
  }

  const originLower = originHeader.toLowerCase();
  const matched = allowedOrigins.some((o) => o.toLowerCase() === originLower);

  if (matched) {
    return { ok: true };
  }

  return { ok: false, status: 403, reason: "origin-not-allowed" };
}
