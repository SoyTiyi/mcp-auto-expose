/**
 * Augments Fastify 5's FastifySchema to include OpenAPI / MCP fields.
 *
 * Fastify 5 tightened FastifySchema to only body/querystring/params/headers/response.
 * The @mcp-auto-expose/fastify plugin (and swagger-based plugins) read description,
 * summary, tags, and hide from the route schema — we need to declare them here so
 * the type-checker accepts them in route definitions.
 *
 * IMPORTANT: this file must have `export {}` so TypeScript treats it as a module
 * and merges (augments) the "fastify" module instead of replacing it.
 */
export {};
declare module "fastify" {
  interface FastifySchema {
    description?: string;
    summary?: string;
    tags?: string[];
    hide?: boolean;
  }
}
