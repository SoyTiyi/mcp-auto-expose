import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import type { MCPTool } from "@mcp-auto-expose/core";
import { resolveTool, ToolRegistry } from "@mcp-auto-expose/core";
import { adaptRouteOptions } from "./adaptRouteOptions.js";
import type { AutoExposeOptions } from "./adaptRouteOptions.js";

declare module "fastify" {
  interface FastifyInstance {
    mcpAutoExpose: {
      tools(): MCPTool[];
    };
  }
}

const autoExposePlugin: FastifyPluginAsync<AutoExposeOptions> = async (
  fastify,
  options,
) => {
  const registry = new ToolRegistry();

  fastify.decorate("mcpAutoExpose", {
    tools(): MCPTool[] {
      return registry.list();
    },
  });

  fastify.addHook("onRoute", (routeOptions) => {
    const descriptors = adaptRouteOptions(routeOptions, options);
    for (const descriptor of descriptors) {
      const tool = resolveTool(descriptor);
      registry.register(tool);
    }
  });
};

export const autoExpose = fp(autoExposePlugin, {
  fastify: "5.x",
  name: "mcp-auto-expose-fastify",
});
