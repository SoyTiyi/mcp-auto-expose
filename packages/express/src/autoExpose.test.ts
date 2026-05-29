import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { INTERNAL_SOURCE } from "@mcp-auto-expose/core/internal";
import { autoExpose } from "./autoExpose.js";
import { mcpExpose } from "./mcpExpose.js";

function makeApp() {
  const app = express();
  const router = express.Router();
  router.get(
    "/users",
    mcpExpose({ description: "Listar usuarios" }),
    async (_req: Request, res: Response) => res.json([]),
  );
  router.get(
    "/users/:id",
    mcpExpose({ params: z.object({ id: z.string() }), description: "Obtener por id" }),
    async (_req: Request, res: Response) => res.json({}),
  );
  router.post(
    "/users",
    mcpExpose({
      body: z.object({ name: z.string(), email: z.string() }),
      description: "Crear usuario",
    }),
    async (_req: Request, res: Response) => res.status(201).json({}),
  );
  app.use("/api", router);
  return app;
}

describe("autoExpose", () => {
  it("tools() returns 3 MCPTools with correct sorted names", () => {
    const handle = autoExpose(makeApp(), { strictSchema: true });
    const tools = handle.tools();
    assert.equal(tools.length, 3);
    assert.equal(tools[0]!.name, "create_users");
    assert.equal(tools[1]!.name, "get_users_by_id");
    assert.equal(tools[2]!.name, "list_users");
  });

  it("get_users_by_id has correct params schema", () => {
    const handle = autoExpose(makeApp(), { strictSchema: true });
    const tools = handle.tools();
    const tool = tools.find((t) => t.name === "get_users_by_id");
    assert.ok(tool, "tool not found");
    const props = tool.inputSchema.properties as Record<string, { type: string }>;
    assert.ok(props["id"], "property id not found");
    assert.equal(props["id"]!.type, "string");
    const required = tool.inputSchema.required as string[];
    assert.ok(Array.isArray(required), "required is not an array");
    assert.ok(required.includes("id"), "id not in required");
  });

  it("create_users has name and email properties", () => {
    const handle = autoExpose(makeApp(), { strictSchema: true });
    const tools = handle.tools();
    const tool = tools.find((t) => t.name === "create_users");
    assert.ok(tool, "tool not found");
    const props = tool.inputSchema.properties as Record<string, unknown>;
    assert.ok("name" in props, "name property missing");
    assert.ok("email" in props, "email property missing");
  });

  it("list_users has correct description", () => {
    const handle = autoExpose(makeApp(), { strictSchema: true });
    const tools = handle.tools();
    const tool = tools.find((t) => t.name === "list_users");
    assert.ok(tool, "tool not found");
    assert.equal(tool.description, "Listar usuarios");
  });

  it("tools() called twice returns the same object reference (memoized)", () => {
    const handle = autoExpose(makeApp(), { strictSchema: true });
    const result1 = handle.tools();
    const result2 = handle.tools();
    assert.ok(Object.is(result1, result2), "tools() not memoized");
  });

  it("refresh() returns a new array but with the same tools", () => {
    const handle = autoExpose(makeApp(), { strictSchema: true });
    const result1 = handle.tools();
    const result2 = handle.refresh();
    assert.ok(!Object.is(result1, result2), "refresh() returned same reference");
    assert.equal(result2.length, result1.length);
    assert.equal(result2[0]!.name, result1[0]!.name);
  });

  it("eager: true — walk happens at autoExpose() call time, not including later routes", () => {
    const app = express();
    const router = express.Router();
    router.get(
      "/users",
      mcpExpose({ description: "Listar usuarios" }),
      async (_req: Request, res: Response) => res.json([]),
    );
    app.use("/api", router);

    // Walk runs eagerly at construction time
    const handle = autoExpose(app, { eager: true, strictSchema: true });

    // Add a route AFTER autoExpose — should NOT appear in tools()
    router.get(
      "/posts",
      mcpExpose({ description: "Listar posts" }),
      async (_req: Request, res: Response) => res.json([]),
    );

    const tools = handle.tools();
    const names = tools.map((t) => t.name);
    assert.ok(names.includes("list_users"), "list_users should be present");
    assert.ok(
      !names.includes("list_posts"),
      "list_posts should NOT be present (added after eager walk)",
    );
  });

  it("INTERNAL_SOURCE.framework === 'express' on every tool", () => {
    const handle = autoExpose(makeApp(), { strictSchema: true });
    const tools = handle.tools();
    for (const tool of tools) {
      assert.equal(tool[INTERNAL_SOURCE].framework, "express");
    }
  });

  it("recovers mount prefix when autoExpose is called before app.use (Express 5.1+ pattern)", () => {
    const app = express();
    // autoExpose BEFORE app.use — wraps app.use to intercept future mounts
    const handle = autoExpose(app, { strictSchema: true });

    const router = express.Router();
    router.get("/users", mcpExpose({ description: "List users" }), (_req: Request, res: Response) =>
      res.json([]),
    );
    app.use("/api", router); // intercepted by autoExpose wrapper

    const tools = handle.tools();
    assert.equal(tools.length, 1);
    // Full path with prefix must be recovered
    assert.equal(tools[0]![INTERNAL_SOURCE].url, "/api/users");
    // generateToolName("/api/users", "GET") strips "api" as a prefix segment → "list_users"
    assert.equal(tools[0]!.name, "list_users");
  });

  it("a route with mcpExpose({ hide: true }) is NOT in tools()", () => {
    const app = express();
    const router = express.Router();
    router.get(
      "/users",
      mcpExpose({ description: "Listar usuarios" }),
      async (_req: Request, res: Response) => res.json([]),
    );
    router.get("/admin/secret", mcpExpose({ hide: true }), async (_req: Request, res: Response) =>
      res.json({}),
    );
    app.use("/api", router);

    const handle = autoExpose(app, { strictSchema: true });
    const tools = handle.tools();
    const names = tools.map((t) => t.name);
    assert.ok(!names.includes("list_admin_secret"), "hidden route should not appear");
    assert.ok(names.includes("list_users"), "visible route should appear");
  });

  it("strictSchema: true — route missing mcpExpose is not in tools()", () => {
    const app = express();
    const router = express.Router();
    router.get(
      "/users",
      mcpExpose({ description: "Listar usuarios" }),
      async (_req: Request, res: Response) => res.json([]),
    );
    // This route has no mcpExpose — should be excluded with strictSchema: true
    router.get("/bare", async (_req: Request, res: Response) => res.json({}));
    app.use("/api", router);

    const handle = autoExpose(app, { strictSchema: true });
    const tools = handle.tools();
    const names = tools.map((t) => t.name);
    assert.ok(!names.includes("list_bare"), "bare route without mcpExpose should not appear");
    assert.ok(names.includes("list_users"), "route with mcpExpose should appear");
  });
});
