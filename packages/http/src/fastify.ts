import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import { createMcpHttp } from "./createMcpHttp.js";
import type { McpHttpOptions, McpIncomingMessage } from "./createMcpHttp.js";

export type McpFastifyPluginOptions = McpHttpOptions;

const mcpFastifyPluginImpl: FastifyPluginAsync<McpFastifyPluginOptions> = async (fastify, opts) => {
  const path = opts.path ?? "/mcp";
  const handle = createMcpHttp(opts);

  fastify.addHook("onClose", async () => {
    await handle.close();
  });

  fastify.route({
    method: ["GET", "POST", "DELETE"],
    url: path,
    handler: async (request, reply) => {
      reply.hijack();
      const mcpReq = request.raw as McpIncomingMessage;
      mcpReq.body = request.body;
      try {
        await handle.handleNodeRequest(mcpReq, reply.raw);
      } catch {
        if (!reply.raw.headersSent) {
          reply.raw.writeHead(500, { "Content-Type": "application/json" });
          reply.raw.end(JSON.stringify({ error: "internal-error" }));
        }
      }
    },
  });
};

export const mcpFastifyPlugin = fp(mcpFastifyPluginImpl, {
  fastify: "^5.0.0",
  name: "@mcp-auto-expose/http/fastify",
});
