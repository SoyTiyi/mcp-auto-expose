import { describe, it, expect } from "vitest";
import Fastify, { type FastifySchema } from "fastify";
import { autoExpose } from "./plugin.js";

// Fastify's FastifySchema TS type omits OpenAPI-style fields (description,
// summary, tags, hide) that the framework accepts at runtime. Use this
// helper to silently widen the schema for test fixtures.
const schema = (s: Record<string, unknown>): FastifySchema => s as FastifySchema;

describe("autoExpose plugin — 3-route CRUD integration", () => {
  it("registers tools for 3 CRUD routes with schemas", async () => {
    const app = Fastify();
    await app.register(autoExpose);

    app.get(
      "/api/users",
      {
        schema: schema({
          description: "Listar usuarios",
        }),
      },
      async () => [],
    );

    app.get(
      "/api/users/:id",
      {
        schema: schema({
          description: "Obtener un usuario por id",
          params: {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
          },
        }),
      },
      async () => ({}),
    );

    app.post(
      "/api/users",
      {
        schema: schema({
          description: "Crear un usuario",
          body: {
            type: "object",
            properties: {
              name: { type: "string" },
              email: { type: "string" },
            },
            required: ["name", "email"],
          },
        }),
      },
      async () => ({}),
    );

    await app.ready();

    const tools = app.mcpAutoExpose.tools();
    expect(tools.length).toBe(3);

    // sorted alphabetically by name
    expect(tools[0]?.name).toBe("create_users");
    expect(tools[1]?.name).toBe("get_users_by_id");
    expect(tools[2]?.name).toBe("list_users");

    // get_users_by_id has `id`
    const byId = tools[1]?.inputSchema.properties;
    expect(byId).toBeTruthy();
    expect("id" in byId!).toBeTruthy();

    // create_users has name + email
    const createProps = tools[0]?.inputSchema.properties;
    expect(createProps).toBeTruthy();
    expect("name" in createProps!).toBeTruthy();
    expect("email" in createProps!).toBeTruthy();

    // description preserved
    expect(tools[2]?.description).toBe("Listar usuarios");

    await app.close();
  });
});

describe("autoExpose plugin — route without schema", () => {
  it("registers a tool with empty inputSchema when no schema is provided", async () => {
    const app = Fastify();
    await app.register(autoExpose);

    app.get("/api/ping", async () => ({ ok: true }));

    await app.ready();

    const tools = app.mcpAutoExpose.tools();
    expect(tools.length).toBe(1);
    const tool = tools[0];
    expect(tool).toBeTruthy();
    expect(tool!.name).toBe("list_ping");
    expect(tool!.inputSchema).toEqual({ type: "object", properties: {} });

    await app.close();
  });
});

describe("autoExpose plugin — strictSchema option", () => {
  it("does NOT register routes without schema when strictSchema: true", async () => {
    const app = Fastify();
    await app.register(autoExpose, { strictSchema: true });

    app.get("/api/ping", async () => ({ ok: true }));

    await app.ready();

    const tools = app.mcpAutoExpose.tools();
    expect(tools.length).toBe(0);

    await app.close();
  });

  it("DOES register routes with body/params/querystring schema when strictSchema: true", async () => {
    const app = Fastify();
    await app.register(autoExpose, { strictSchema: true });

    app.post(
      "/api/items",
      {
        schema: {
          body: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
      },
      async () => ({}),
    );

    await app.ready();

    const tools = app.mcpAutoExpose.tools();
    expect(tools.length).toBe(1);
    expect(tools[0]?.name).toBe("create_items");

    await app.close();
  });
});

describe("autoExpose plugin — schema.hide excludes route", () => {
  it("does not register a route whose schema.hide is true", async () => {
    const app = Fastify();
    await app.register(autoExpose);

    app.get(
      "/api/secret",
      {
        schema: schema({ hide: true }),
      },
      async () => ({}),
    );

    app.get("/api/public", async () => ({}));

    await app.ready();

    const tools = app.mcpAutoExpose.tools();
    expect(tools.length).toBe(1);
    expect(tools[0]?.name).toBe("list_public");

    await app.close();
  });
});
