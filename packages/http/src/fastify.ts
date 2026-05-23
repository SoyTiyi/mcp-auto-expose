import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import type { McpHttpOptions } from "./createMcpHttp.js";

export type McpFastifyPluginOptions = McpHttpOptions;

const mcpFastifyPluginImpl: FastifyPluginAsync<McpFastifyPluginOptions> = async (_fastify, _opts) => {
  throw new Error("not implemented");
};

export const mcpFastifyPlugin = fp(mcpFastifyPluginImpl, {
  fastify: "^5.0.0",
  name: "@mcp-auto-expose/http/fastify",
});
