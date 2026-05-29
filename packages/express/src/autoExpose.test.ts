import { describe, it, expect } from "vitest";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { INTERNAL_SOURCE } from "@mcp-auto-expose/core/internal";
import { autoExpose, mount } from "./autoExpose.js";
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
  const handle = autoExpose(app, { strictSchema: true });
  app.use("/api", router);
  mount(handle, "/api", router);
  return handle;
}

describe("autoExpose", () => {
  it("tools() returns 3 MCPTools with correct sorted names", () => {
    const handle = makeApp();
    const tools = handle.tools();
    expect(tools.length).toBe(3);
    expect(tools[0]!.name).toBe("create_users");
    expect(tools[1]!.name).toBe("get_users_by_id");
    expect(tools[2]!.name).toBe("list_users");
  });

  it("get_users_by_id has correct params schema", () => {
    const handle = makeApp();
    const tools = handle.tools();
    const tool = tools.find((t) => t.name === "get_users_by_id");
    expect(tool, "tool not found").toBeTruthy();
    const props = tool!.inputSchema.properties as Record<string, { type: string }>;
    expect(props["id"], "property id not found").toBeTruthy();
    expect(props["id"]!.type).toBe("string");
    const required = tool!.inputSchema.required as string[];
    expect(Array.isArray(required), "required is not an array").toBeTruthy();
    expect(required.includes("id"), "id not in required").toBeTruthy();
  });

  it("create_users has name and email properties", () => {
    const handle = makeApp();
    const tools = handle.tools();
    const tool = tools.find((t) => t.name === "create_users");
    expect(tool, "tool not found").toBeTruthy();
    const props = tool!.inputSchema.properties as Record<string, unknown>;
    expect("name" in props, "name property missing").toBeTruthy();
    expect("email" in props, "email property missing").toBeTruthy();
  });

  it("list_users has correct description", () => {
    const handle = makeApp();
    const tools = handle.tools();
    const tool = tools.find((t) => t.name === "list_users");
    expect(tool, "tool not found").toBeTruthy();
    expect(tool!.description).toBe("Listar usuarios");
  });

  it("tools() called twice returns the same object reference (memoized)", () => {
    const handle = makeApp();
    const result1 = handle.tools();
    const result2 = handle.tools();
    expect(Object.is(result1, result2), "tools() not memoized").toBeTruthy();
  });

  it("refresh() returns a new array but with the same tools", () => {
    const handle = makeApp();
    const result1 = handle.tools();
    const result2 = handle.refresh();
    expect(!Object.is(result1, result2), "refresh() returned same reference").toBeTruthy();
    expect(result2.length).toBe(result1.length);
    expect(result2[0]!.name).toBe(result1[0]!.name);
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

    // Walk runs eagerly at construction time — mount() called after so sub-router IS captured eagerly
    const handle = autoExpose(app, { eager: true, strictSchema: true });
    mount(handle, "/api", router);

    // Add a route AFTER autoExpose + mount — should NOT appear in tools()
    router.get(
      "/posts",
      mcpExpose({ description: "Listar posts" }),
      async (_req: Request, res: Response) => res.json([]),
    );

    const tools = handle.tools();
    const names = tools.map((t) => t.name);
    expect(names.includes("list_users"), "list_users should be present").toBeTruthy();
    expect(
      !names.includes("list_posts"),
      "list_posts should NOT be present (added after eager walk)",
    ).toBeTruthy();
  });

  it("INTERNAL_SOURCE.framework === 'express' on every tool", () => {
    const handle = makeApp();
    const tools = handle.tools();
    for (const tool of tools) {
      expect(tool[INTERNAL_SOURCE].framework).toBe("express");
    }
  });

  it("mount() registers sub-router routes with the given prefix", () => {
    const app = express();
    const handle = autoExpose(app, { strictSchema: true });

    const router = express.Router();
    router.get("/users", mcpExpose({ description: "List users" }), (_req: Request, res: Response) =>
      res.json([]),
    );

    app.use("/api", router);
    mount(handle, "/api", router); // explicit instead of monkey-patch

    const tools = handle.tools();
    expect(tools.length).toBe(1);
    expect(tools[0]![INTERNAL_SOURCE].url).toBe("/api/users");
    expect(tools[0]!.name).toBe("list_users");
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
    const handle = autoExpose(app, { strictSchema: true });
    app.use("/api", router);
    mount(handle, "/api", router);

    const tools = handle.tools();
    const names = tools.map((t) => t.name);
    expect(!names.includes("list_admin_secret"), "hidden route should not appear").toBeTruthy();
    expect(names.includes("list_users"), "visible route should appear").toBeTruthy();
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
    const handle = autoExpose(app, { strictSchema: true });
    app.use("/api", router);
    mount(handle, "/api", router);

    const tools = handle.tools();
    const names = tools.map((t) => t.name);
    expect(!names.includes("list_bare"), "bare route without mcpExpose should not appear").toBeTruthy();
    expect(names.includes("list_users"), "route with mcpExpose should appear").toBeTruthy();
  });
});
