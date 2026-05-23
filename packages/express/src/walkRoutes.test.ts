import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MCP_EXPOSE_SYMBOL } from "./mcpExpose.js";
import { walkRoutes } from "./walkRoutes.js";

// Mock a terminal route layer
function routeLayer(
  methods: string | string[],
  path: string | string[],
  handlers: unknown[] = [],
) {
  const methodMap: Record<string, boolean> = {};
  const ms = Array.isArray(methods) ? methods : [methods];
  for (const m of ms) methodMap[m.toLowerCase()] = true;
  return {
    route: {
      path,
      methods: methodMap,
      stack: handlers.map((h) => ({ handle: h })),
    },
  };
}

// Express 5 sub-router layer (has layer.path)
function routerLayerV5(mountPath: string, children: unknown[]) {
  return { name: "router", path: mountPath, handle: { stack: children } };
}

// Express 4 sub-router layer (regexp-based, no layer.path)
function routerLayerV4(regexpSource: string, fastSlash: boolean, children: unknown[]) {
  const regexp = Object.assign(new RegExp(regexpSource, "i"), { fast_slash: fastSlash });
  return { name: "router", regexp, handle: { stack: children } };
}

// Create a handler tagged with MCP_EXPOSE_SYMBOL
function tagged(schema: object) {
  const fn = () => {};
  (fn as unknown as Record<symbol, object>)[MCP_EXPOSE_SYMBOL] = schema;
  return fn;
}

// Create a mock Express app with a root stack (Express 5 style)
function mockApp(stack: unknown[]) {
  return { router: { stack } };
}

describe("walkRoutes — test 1: simple GET /api/users", () => {
  it("emits 1 descriptor with method GET and url /api/users, schema undefined", () => {
    const app = mockApp([routeLayer("get", "/api/users")]);
    const result = walkRoutes(app, { strictSchema: false });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.method, "GET");
    assert.equal(result[0]?.url, "/api/users");
    assert.equal(result[0]?.schema, undefined);
    assert.equal(result[0]?.framework, "express");
  });
});

describe("walkRoutes — test 2: Express 5 sub-router", () => {
  it("routerLayerV5('/api', [routeLayer('get', '/users')]) → url /api/users", () => {
    const app = mockApp([
      routerLayerV5("/api", [routeLayer("get", "/users")]),
    ]);
    const result = walkRoutes(app, { strictSchema: false });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.url, "/api/users");
    assert.equal(result[0]?.method, "GET");
  });
});

describe("walkRoutes — test 3: Express 4 sub-router with regexp", () => {
  it("regexp source for /api mount → url /api/users", () => {
    // This is the canonical Express 4 regexp source for app.use("/api", router)
    const regexpSource = String.raw`^\/api\/?(?=\/|$)`;
    const app = mockApp([
      routerLayerV4(regexpSource, false, [routeLayer("get", "/users")]),
    ]);
    const result = walkRoutes(app, { strictSchema: false });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.url, "/api/users");
  });
});

describe("walkRoutes — test 4: _all filtered", () => {
  it("methods: { get: true, _all: true } → only GET emitted", () => {
    const app = mockApp([
      routeLayer(["get", "_all"], "/users"),
    ]);
    const result = walkRoutes(app, { strictSchema: false });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.method, "GET");
  });
});

describe("walkRoutes — test 5: unknown method", () => {
  it("methods: { propfind: true } → 0 descriptors emitted", () => {
    const app = mockApp([routeLayer("propfind", "/users")]);
    const result = walkRoutes(app, { strictSchema: false });
    assert.equal(result.length, 0);
  });
});

describe("walkRoutes — test 6: duplicate route", () => {
  it("two GET /api/users layers → 1 descriptor in output", () => {
    const app = mockApp([
      routeLayer("get", "/api/users"),
      routeLayer("get", "/api/users"),
    ]);
    const result = walkRoutes(app, { strictSchema: false });
    assert.equal(result.length, 1);
  });
});

describe("walkRoutes — test 7: extractSchema one tagged handler", () => {
  it("route with one tagged handler → schema is present in descriptor", () => {
    const schema = { description: "list users" };
    const handler = tagged(schema);
    const app = mockApp([routeLayer("get", "/users", [handler])]);
    const result = walkRoutes(app, { strictSchema: false });
    assert.equal(result.length, 1);
    assert.deepEqual(result[0]?.schema, schema);
  });
});

describe("walkRoutes — test 8: extractSchema multiple tagged handlers", () => {
  it("route with two tagged handlers → first schema used", () => {
    const schema1 = { description: "first" };
    const schema2 = { description: "second" };
    const handler1 = tagged(schema1);
    const handler2 = tagged(schema2);
    const app = mockApp([routeLayer("get", "/users", [handler1, handler2])]);
    const result = walkRoutes(app, { strictSchema: false });
    assert.equal(result.length, 1);
    assert.deepEqual(result[0]?.schema, schema1);
  });
});

describe("walkRoutes — test 9: extractSchema none tagged", () => {
  it("route with no tagged handler → schema is undefined", () => {
    const plainFn = () => {};
    const app = mockApp([routeLayer("get", "/users", [plainFn])]);
    const result = walkRoutes(app, { strictSchema: false });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.schema, undefined);
  });
});

describe("walkRoutes — test 10: strictSchema:true + no schema", () => {
  it("strictSchema:true and route with no tagged handler → 0 descriptors", () => {
    const app = mockApp([routeLayer("get", "/users")]);
    const result = walkRoutes(app, { strictSchema: true });
    assert.equal(result.length, 0);
  });
});

describe("walkRoutes — test 11: strictSchema:false + no schema", () => {
  it("strictSchema:false and route with no tagged handler → descriptor included with schema undefined", () => {
    const app = mockApp([routeLayer("get", "/users")]);
    const result = walkRoutes(app, { strictSchema: false });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.schema, undefined);
  });
});

describe("walkRoutes — test 12: hide:true in schema", () => {
  it("schema with hide:true → 0 descriptors", () => {
    const handler = tagged({ hide: true });
    const app = mockApp([routeLayer("get", "/users", [handler])]);
    const result = walkRoutes(app, { strictSchema: false });
    assert.equal(result.length, 0);
  });
});

describe("walkRoutes — test 13: array of paths", () => {
  it("route.path = ['/a', '/b'] → 2 descriptors", () => {
    const app = mockApp([routeLayer("get", ["/a", "/b"])]);
    const result = walkRoutes(app, { strictSchema: false });
    assert.equal(result.length, 2);
    const urls = result.map((d) => d.url).sort();
    assert.deepEqual(urls, ["/a", "/b"]);
  });
});

describe("walkRoutes — test 14: basePath prefix", () => {
  it("basePath '/prefix' + route at '/users' → url '/prefix/users'", () => {
    const app = mockApp([routeLayer("get", "/users")]);
    const result = walkRoutes(app, { strictSchema: false, basePath: "/prefix" });
    assert.equal(result.length, 1);
    assert.equal(result[0]?.url, "/prefix/users");
  });
});

describe("walkRoutes — test 15: mountRegistry for Express 5.1+ sub-router mount path", () => {
  it("uses mountRegistry to recover mount path when layer.path and layer.regexp are absent", () => {
    const mountRegistry = new WeakMap<object, string>();

    // Simulate a sub-router handle with no layer.path / layer.regexp (Express 5.1+)
    function routerHandle() {}
    (routerHandle as unknown as { stack: unknown[] }).stack = [
      {
        route: {
          path: "/users",
          methods: { get: true },
          stack: [],
        },
      },
    ];

    mountRegistry.set(routerHandle, "/api");

    const fakeStack = [
      {
        name: "router",
        handle: routerHandle as unknown as { stack: unknown[] } & ((...a: unknown[]) => void),
        regexp: undefined,
        path: undefined,
        slash: false,
      },
    ];

    const descriptors = walkRoutes(mockApp(fakeStack), { strictSchema: false, mountRegistry });
    assert.equal(descriptors.length, 1);
    assert.equal(descriptors[0]?.url, "/api/users");
  });
});
