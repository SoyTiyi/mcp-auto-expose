import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
    assert.equal(tools.length, 3);

    // sorted alphabetically by name
    assert.equal(tools[0]?.name, "create_users");
    assert.equal(tools[1]?.name, "get_users_by_id");
    assert.equal(tools[2]?.name, "list_users");

    // get_users_by_id has `id`
    const byId = tools[1]?.inputSchema.properties;
    assert.ok(byId);
    assert.ok("id" in byId);

    // create_users has name + email
    const createProps = tools[0]?.inputSchema.properties;
    assert.ok(createProps);
    assert.ok("name" in createProps);
    assert.ok("email" in createProps);

    // description preserved
    assert.equal(tools[2]?.description, "Listar usuarios");

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
    assert.equal(tools.length, 1);
    const tool = tools[0];
    assert.ok(tool);
    assert.equal(tool.name, "list_ping");
    assert.deepEqual(tool.inputSchema, { type: "object", properties: {} });

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
    assert.equal(tools.length, 0);

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
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.name, "create_items");

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
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.name, "list_public");

    await app.close();
  });
});
