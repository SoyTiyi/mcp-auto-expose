import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flattenSchema, buildToolSchema, renameOnCollision } from "./flattenSchema.js";

describe("flattenSchema", () => {
  it("1. undefined → returns { type: 'object', properties: {} } with no required key", () => {
    const result = flattenSchema(undefined);
    assert.deepEqual(result, { type: "object", properties: {} });
    assert.ok(!("required" in result), "should have no 'required' key");
  });

  it("2. params only — properties merged, required preserved", () => {
    const result = flattenSchema({
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    });
    assert.deepEqual(result, {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    });
  });

  it("3. body object + querystring object — all properties merged into flat output", () => {
    const result = flattenSchema({
      querystring: {
        type: "object",
        properties: { search: { type: "string" } },
      },
      body: {
        type: "object",
        properties: { name: { type: "string" }, age: { type: "number" } },
        required: ["name"],
      },
    });
    assert.deepEqual(result, {
      type: "object",
      properties: {
        search: { type: "string" },
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name"],
    });
  });

  it("4. key collision — params keeps original key, body gets renamed to body_<key>", () => {
    const result = flattenSchema({
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: { id: { type: "number" } },
        required: ["id"],
      },
    });
    assert.deepEqual(result, {
      type: "object",
      properties: {
        id: { type: "string" },
        body_id: { type: "number" },
      },
      required: ["id", "body_id"],
    });
  });

  it("5. body primitive (type: 'string') — wrapped under 'body' key", () => {
    const result = flattenSchema({
      body: { type: "string" },
    });
    assert.deepEqual(result, {
      type: "object",
      properties: { body: { type: "string" } },
    });
    assert.ok(!("required" in result), "should have no 'required' key");
  });

  it("6. $ref in a property schema — property is skipped, no error thrown", () => {
    // Redirect stderr to avoid test noise from the $ref warning
    const originalWrite = process.stderr.write.bind(process.stderr);
    let stderrOutput = "";
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderrOutput += chunk.toString();
      return true;
    };

    let result;
    try {
      result = flattenSchema({
        body: {
          type: "object",
          properties: {
            user: { $ref: "#/definitions/User" },
            name: { type: "string" },
          },
          required: ["user", "name"],
        },
      });
    } finally {
      process.stderr.write = originalWrite;
    }

    // 'user' ($ref) is skipped; 'name' is present
    assert.ok(!("user" in result.properties), "'user' should be skipped");
    assert.ok("name" in result.properties, "'name' should be present");
    assert.deepEqual(result.properties.name, { type: "string" });
    // required: 'user' is skipped (since it was a $ref), 'name' is included
    assert.deepEqual(result.required, ["name"]);
    assert.ok(stderrOutput.includes("$ref"), "stderr should mention $ref skip");
  });

  it("7. required fields — combined from params and body correctly", () => {
    const result = flattenSchema({
      params: {
        type: "object",
        properties: {
          teamId: { type: "string" },
          userId: { type: "string" },
        },
        required: ["teamId", "userId"],
      },
      body: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
        },
        required: ["title"],
      },
    });
    assert.deepEqual(result, {
      type: "object",
      properties: {
        teamId: { type: "string" },
        userId: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
      },
      required: ["teamId", "userId", "title"],
    });
  });
});

describe("buildToolSchema — paramMap", () => {
  it("1. params only — paramMap keys map to 'params'", () => {
    const { inputSchema, paramMap } = buildToolSchema({
      params: {
        type: "object",
        properties: { id: { type: "string" }, slug: { type: "string" } },
        required: ["id"],
      },
    });
    assert.deepEqual(inputSchema.properties, { id: { type: "string" }, slug: { type: "string" } });
    assert.deepEqual(paramMap, { id: "params", slug: "params" });
  });

  it("2. params + body collision — renamed key keeps body origin", () => {
    const { inputSchema, paramMap } = buildToolSchema({
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: { id: { type: "number" }, email: { type: "string" } },
        required: ["id"],
      },
    });
    assert.ok("id" in inputSchema.properties, "id from params present");
    assert.ok("body_id" in inputSchema.properties, "body_id (renamed) present");
    assert.equal(paramMap["id"], "params");
    assert.equal(paramMap["body_id"], "body");
    assert.equal(paramMap["email"], "body");
  });

  it("3. body primitive (non-object) — wrapped under 'body' key, paramMap has body: 'body'", () => {
    const { inputSchema, paramMap } = buildToolSchema({
      body: { type: "string" },
    });
    assert.ok("body" in inputSchema.properties, "'body' key should be present");
    assert.deepEqual(paramMap, { body: "body" });
  });

  it("4. $ref-skipped property — does NOT appear in paramMap", () => {
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;

    let result;
    try {
      result = buildToolSchema({
        body: {
          type: "object",
          properties: {
            user: { $ref: "#/definitions/User" },
            name: { type: "string" },
          },
        },
      });
    } finally {
      process.stderr.write = originalWrite;
    }

    assert.ok(!("user" in result.paramMap), "'user' ($ref) must not be in paramMap");
    assert.equal(result.paramMap["name"], "body");
  });

  it("5. querystring properties — paramMap keys map to 'querystring'", () => {
    const { paramMap } = buildToolSchema({
      querystring: {
        type: "object",
        properties: { page: { type: "number" }, limit: { type: "number" } },
      },
    });
    assert.deepEqual(paramMap, { page: "querystring", limit: "querystring" });
  });

  it("6. mixed params + querystring + body — all origins recorded", () => {
    const { paramMap } = buildToolSchema({
      params: { type: "object", properties: { id: { type: "string" } } },
      querystring: { type: "object", properties: { format: { type: "string" } } },
      body: { type: "object", properties: { name: { type: "string" } } },
    });
    assert.equal(paramMap["id"], "params");
    assert.equal(paramMap["format"], "querystring");
    assert.equal(paramMap["name"], "body");
  });
});

describe("renameOnCollision", () => {
  it("returns source_key format", () => {
    // We redirect stderr to avoid test noise
    const originalWrite = process.stderr.write.bind(process.stderr);
    let stderrOutput = "";
    process.stderr.write = (chunk: string | Uint8Array) => {
      stderrOutput += chunk.toString();
      return true;
    };

    const result = renameOnCollision("id", "body");

    process.stderr.write = originalWrite;

    assert.equal(result, "body_id");
    assert.ok(stderrOutput.includes("body_id"), "stderr should mention renamed key");
  });
});
