import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { generateToolName } from "./toolName.js";

describe("generateToolName - CRUD table", () => {
  it("GET /api/users → list_users (no params)", () => {
    expect(generateToolName("GET", "/api/users")).toBe("list_users");
  });

  it("GET /api/users/:id → get_users_by_id (colon param)", () => {
    expect(generateToolName("GET", "/api/users/:id")).toBe("get_users_by_id");
  });

  it("GET /api/teams/:teamId/users/:userId → get_users_by_team_id_and_user_id (multiple params)", () => {
    expect(generateToolName("GET", "/api/teams/:teamId/users/:userId")).toBe(
      "get_users_by_team_id_and_user_id",
    );
  });

  it("POST /api/users → create_users", () => {
    expect(generateToolName("POST", "/api/users")).toBe("create_users");
  });

  it("PUT /api/users/:id → replace_users_by_id", () => {
    expect(generateToolName("PUT", "/api/users/:id")).toBe("replace_users_by_id");
  });

  it("PUT /api/users (no params) → replace_users", () => {
    expect(generateToolName("PUT", "/api/users")).toBe("replace_users");
  });

  it("PATCH /api/users/:id → update_users_by_id", () => {
    expect(generateToolName("PATCH", "/api/users/:id")).toBe("update_users_by_id");
  });

  it("PATCH /api/users (no params) → update_users", () => {
    expect(generateToolName("PATCH", "/api/users")).toBe("update_users");
  });

  it("DELETE /api/users/:id → delete_users_by_id", () => {
    expect(generateToolName("DELETE", "/api/users/:id")).toBe("delete_users_by_id");
  });

  it("DELETE /api/users (no params) → delete_users", () => {
    expect(generateToolName("DELETE", "/api/users")).toBe("delete_users");
  });

  it("OPTIONS /api/users → options_users (HEAD/OPTIONS pattern)", () => {
    expect(generateToolName("OPTIONS", "/api/users")).toBe("options_users");
  });

  it("HEAD /api/users → head_users (HEAD/OPTIONS pattern)", () => {
    expect(generateToolName("HEAD", "/api/users")).toBe("head_users");
  });
});

describe("generateToolName - curly brace params", () => {
  it("GET /api/users/{id} → get_users_by_id", () => {
    expect(generateToolName("GET", "/api/users/{id}")).toBe("get_users_by_id");
  });
});

describe("generateToolName - truncation", () => {
  it("name > 64 chars is truncated to exactly 64 chars with _h<6-char-hash>", () => {
    // Use a URL that generates a long name:
    // GET /api/very-long-resource-name-that-will-exceed-the-limit/:parameterNameThatIsAlsoLong
    // resource = "very_long_resource_name_that_will_exceed_the_limit"
    // param    = "parameterNameThatIsAlsoLong"
    // name     = "get_very_long_resource_name_that_will_exceed_the_limit_by_parameterNameThatIsAlsoLong"
    const method = "GET";
    const url =
      "/api/very-long-resource-name-that-will-exceed-the-limit/:parameterNameThatIsAlsoLong";
    const result = generateToolName(method, url);

    expect(result.length, `Expected length 64, got ${result.length}: "${result}"`).toBe(64);

    const expectedHash = createHash("sha256").update(`${method}:${url}`).digest("hex").slice(0, 6);

    expect(
      result.endsWith(`_h${expectedHash}`),
      `Expected result to end with "_h${expectedHash}", got: "${result}"`,
    ).toBeTruthy();
  });
});
