import { createHash } from "node:crypto";
import type { HTTPMethod } from "./types.js";

/** Convert a string to snake_case: split on camelCase, replace non-alphanumeric chars with `_`, lowercase, trim `_`. */
function toSnakeCase(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2") // insert `_` before uppercase letters
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Classify a URL segment as static or a param, and return the param name if it is one. */
function classifySegment(segment: string): { type: "static" | "param"; name: string } {
  if (segment.startsWith(":")) {
    return { type: "param", name: segment.slice(1) };
  }
  if (segment.startsWith("{") && segment.endsWith("}")) {
    return { type: "param", name: segment.slice(1, -1) };
  }
  return { type: "static", name: segment };
}

/**
 * Generate a deterministic MCP tool name from an HTTP method and URL path.
 *
 * The name is at most 64 characters. If the natural name exceeds that, it is
 * truncated to 56 characters and `_h<6-char-hash>` is appended, for a total of
 * exactly 64 characters. The hash is derived from `method:url`.
 */
export function generateToolName(method: HTTPMethod, url: string): string {
  // Step 1: tokenize URL
  const segments = url.split("/").filter((s) => s.length > 0);

  // Step 2 + 3: classify and derive resource / params
  const params: string[] = [];
  let resource = "";

  for (const segment of segments) {
    const classified = classifySegment(segment);
    if (classified.type === "param") {
      params.push(classified.name);
    } else {
      resource = toSnakeCase(classified.name);
    }
  }

  // Step 4: build name
  const hasParams = params.length > 0;
  const paramSuffix = params.map(toSnakeCase).join("_and_");

  let name: string;

  switch (method) {
    case "GET":
      name = hasParams ? `get_${resource}_by_${paramSuffix}` : `list_${resource}`;
      break;
    case "POST":
      name = `create_${resource}`;
      break;
    case "PUT":
      name = hasParams ? `replace_${resource}_by_${paramSuffix}` : `replace_${resource}`;
      break;
    case "PATCH":
      name = hasParams ? `update_${resource}_by_${paramSuffix}` : `update_${resource}`;
      break;
    case "DELETE":
      name = hasParams ? `delete_${resource}_by_${paramSuffix}` : `delete_${resource}`;
      break;
    case "HEAD":
    case "OPTIONS":
      name = `${method.toLowerCase()}_${resource}`;
      break;
    default: {
      // Exhaustive guard — TypeScript ensures this is unreachable
      const _exhaustive: never = method;
      name = `${String(_exhaustive).toLowerCase()}_${resource}`;
    }
  }

  // Step 5: truncation
  if (name.length > 64) {
    const hash = createHash("sha256").update(`${method}:${url}`).digest("hex").slice(0, 6);
    name = `${name.slice(0, 56)}_h${hash}`;
  }

  return name;
}
