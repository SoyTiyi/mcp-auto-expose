import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flattenSchema, renameOnCollision } from "./flattenSchema.js";

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
