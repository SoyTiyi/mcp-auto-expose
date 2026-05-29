# Phase 5 — Vitest Migration + Strict TypeScript Flags

> **Status:** Approved — implementation in progress.
> **Methodology:** Spec-Driven Development (SDD).
> **Approved predecessors:** Phase 1 (Fastify), Phase 2 (stdio), Phase 3 (Express), Phase 4 (Streamable HTTP).

---

## Context

The monorepo currently uses Node's built-in test runner (`node:test` + `node:assert/strict`) invoked via `node --import tsx --test`, with no coverage tooling or CI gating. This sprint accomplishes two complementary goals:

1. **T10 — Vitest migration**: Replace all 27 test files across 5 packages with Vitest for a unified runner, richer assertion APIs, and coverage gating (lines ≥ 90%).
2. **T9 — Strict TypeScript flags**: Activate 4 additional strict compiler flags (`noFallthroughCasesInSwitch`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`) one at a time to increase type safety across the entire codebase.

Expected outcomes:
- Single, modern test runner + coverage enforcement (Vitest).
- 240+ test cases execute identically before and after.
- 4 strict flags enabled in sequence; no new `as any`, `!`, `@ts-ignore`, `@ts-nocheck` suppressions added.
- Type safety barrier raises against common mistakes (missed switch cases, method override bugs, optional property pitfalls).

---

## 1. T10 — Vitest Migration

### 1.1 File inventory

| Package               | Test files | Approx. cases |
|-----------------------|------------|---------------|
| `packages/core`       | 9          | 80            |
| `packages/fastify`    | 3          | 40            |
| `packages/express`    | 5          | 60            |
| `packages/http`       | 7          | 40            |
| `packages/stdio`      | 3          | 20            |
| **Total**             | **27**     | **240+**      |

### 1.2 Current test infrastructure

- **Runner**: Node's `--import tsx --test`
- **Assertions**: `node:assert/strict`
- **Doubles**: all hand-written stubs and monkey-patches; no mocking library (`sinon`, `jest.fn()`, `vi.fn()`)
- **Coverage**: none; no CI gating
- **Type tests**: `types.test.ts` files using TypeScript error expectations (rebranded to `types.runtime.test.ts`)

### 1.3 Node:test → Vitest conversion table

| node:test / node:assert | vitest |
|---|---|
| `import { describe, it } from "node:test"` | `import { describe, it, expect } from "vitest"` |
| `import assert from "node:assert/strict"` | (eliminate) |
| `assert.equal(a, b)` | `expect(a).toBe(b)` |
| `assert.deepEqual(a, b)` | `expect(a).toEqual(b)` |
| `assert.strictEqual(a, b)` | `expect(a).toBe(b)` |
| `assert.notEqual(a, b)` | `expect(a).not.toBe(b)` |
| `assert.notDeepEqual(a, b)` | `expect(a).not.toEqual(b)` |
| `assert.throws(() => f())` | `expect(() => f()).toThrow()` |
| `assert.throws(() => f(), /regex/)` | `expect(() => f()).toThrow(/regex/)` |
| `assert.ok(x)` | `expect(x).toBeTruthy()` |
| `assert.ok(!x)` | `expect(x).toBeFalsy()` |
| `await assert.rejects(p, /regex/)` | `await expect(p).rejects.toThrow(/regex/)` |
| `assert.match(str, /regex/)` | `expect(str).toMatch(/regex/)` |
| `assert.doesNotThrow(() => f())` | `expect(() => f()).not.toThrow()` |
| `before` (from `node:test`) | `import { beforeAll } from "vitest"` |
| `after` (from `node:test`) | `import { afterAll } from "vitest"` |
| `afterEach` (from `node:test`) | `import { afterEach } from "vitest"` |

### 1.4 Vitest configuration

Each of the 5 library packages gets an identical `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test-d.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      exclude: [
        "**/*.test.ts",
        "**/*.test-d.ts",
        "**/dist/**",
        "**/node_modules/**",
      ],
      thresholds: { lines: 90 },
    },
  },
});
```

### 1.5 Critical constraint: `.js` extension resolution

All 5 library packages use `"type": "module"` with `"moduleResolution": "NodeNext"` and write explicit `.js` relative imports (e.g., `from "./toolName.js"`). Vitest must be configured to resolve `.js` → `.ts` during test execution to maintain compatibility with the build output structure. This is automatic in Vitest's default mode; validation occurs during the test runs.

### 1.6 File renames

- `packages/core/src/types.test.ts` → `packages/core/src/types.runtime.test.ts`

Rationale: `types.test.ts` conventionally names runtime test files; the `.runtime` suffix clarifies that this file contains executable test code (not type-level assertions for type-checking IDEs).

### 1.7 Integration into `package.json` scripts

Each library package's `scripts` section:

```jsonc
{
  "scripts": {
    "build": "tsc -b",
    "check-types": "tsc -b --noEmit",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint . --max-warnings 0"
  }
}
```

Apps (e.g., `apps/dev-sandbox`) do not publish tests; they use the same script config for local smoke testing.

---

## 2. T9 — Strict TypeScript Flags

Four compiler flags are enabled sequentially, one at a time. Between each activation, `pnpm check-types && pnpm test` must pass in all 5 packages and `apps/dev-sandbox`.

### 2.1 Flag activation order

#### 2.1.1 noFallthroughCasesInSwitch (lowest risk)

**TypeScript docs:** Enforce that every case in a switch statement (other than empty fallthrough) either `break`s, `return`s, or `throw`s.

**Risk profile:** Very low. The codebase has only one switch statement: `packages/core/src/toolName.ts` (HEAD → OPTIONS mapping). The fallthrough is intentional and compliant (empty case body followed by `break`).

**Known issues:** Zero.

**Procedure:**
1. Add `"noFallthroughCasesInSwitch": true` to `tsconfig.json` root.
2. Run `pnpm check-types` → expect pass.
3. Run `pnpm test` → expect all 240+ cases pass.
4. Commit: `feat(ts): enable noFallthroughCasesInSwitch`.

#### 2.1.2 noImplicitOverride (zero risk)

**TypeScript docs:** Require `override` keyword on derived class methods that override a base method.

**Risk profile:** Zero. The codebase has no `class` definitions; hence no inheritance.

**Known issues:** Zero.

**Procedure:**
1. Add `"noImplicitOverride": true` to `tsconfig.json` root.
2. Run `pnpm check-types` → expect pass.
3. Run `pnpm test` → expect all cases pass.
4. Commit: `feat(ts): enable noImplicitOverride`.

#### 2.1.3 exactOptionalPropertyTypes (highest impact)

**TypeScript docs:** When set to `true`, optional properties are typed as `T | undefined` rather than `T?`. This prevents assigning `undefined` to properties not explicitly declared as `undefined`.

**Risk profile:** High impact but manageable. Two known break sites:

**Break site 1: `packages/fastify/src/adaptRouteOptions.ts:48–58`**

```typescript
// Before (currently valid):
const schema: RouteSchema = {
  body: bodySchema,
  response: responses,
};
// When `bodySchema` is undefined or `responses` is undefined,
// the assignment violates exactOptionalPropertyTypes.
```

**Fix:** Use conditional spreads:

```typescript
const schema: RouteSchema = {
  ...(bodySchema ? { body: bodySchema } : {}),
  ...(responses ? { response: responses } : {}),
};
```

**Break site 2: `packages/http/src/createMcpHttp.ts:343–351 and :395–403`**

Two object literals build `McpHttpContext`:

```typescript
// Before (can assign undefined values):
const ctx: McpHttpContext = {
  headers: ...,
  mcp: ...,
  headerParams: ...,
  auth: req.auth,        // req.auth may be undefined
  traceContext: extractTraceContext(...),  // may be undefined
};
```

**Fix:** Use conditional spreads:

```typescript
const ctx: McpHttpContext = {
  headers: ...,
  mcp: ...,
  headerParams: ...,
  ...(req.auth ? { auth: req.auth } : {}),
  ...(traceContext ? { traceContext } : {}),
};
```

Then update `McpHttpContext` type to remove `?` from optional fields (TypeScript will enforce they are absent, not present with `undefined`).

**Procedure:**
1. Fix break site 1 in `packages/fastify`.
2. Fix break site 2 in `packages/http`.
3. Update `McpHttpContext` type definition.
4. Add `"exactOptionalPropertyTypes": true` to `tsconfig.json` root.
5. Run `pnpm check-types` → expect pass.
6. Run `pnpm test` → expect all cases pass.
7. Commit: `feat(ts): enable exactOptionalPropertyTypes; fix optional property assignments`.

#### 2.1.4 noPropertyAccessFromIndexSignature (near-zero risk)

**TypeScript docs:** When an object has an index signature (e.g., `Record<string, T>`), require bracket access (`obj["key"]`) instead of dot access (`obj.key`). Prevents typos on dynamically-computed keys.

**Risk profile:** Near-zero. The codebase already favors bracket access on `Record` and index-signature types.

**Known issues:** Zero (code is already aligned with this flag's intention).

**Procedure:**
1. Add `"noPropertyAccessFromIndexSignature": true` to `tsconfig.json` root.
2. Run `pnpm check-types` → expect pass.
3. Run `pnpm test` → expect all cases pass.
4. Commit: `feat(ts): enable noPropertyAccessFromIndexSignature`.

### 2.2 Suppression baseline (hard rule)

**Current state:** Zero `as any`, zero `@ts-ignore`, zero `@ts-nocheck`. Five documented `!` non-null assertions for TS#42192 symbol workaround (acceptable, not being increased).

**Hard rule:** No new suppressions of any kind (`as any`, `!`, `@ts-ignore`, `@ts-nocheck`) added to fix flag errors. If a fix requires a suppression, the approach is wrong — rethink the type design.

---

## 3. Validation Matrix

| Check | Command | Expected | Notes |
|-------|---------|----------|-------|
| **Build** | `pnpm build` | ✅ All packages | TypeScript transpilation |
| **Type check** | `pnpm check-types` | ✅ Zero errors | All 5 packages + dev-sandbox |
| **Lint** | `pnpm lint` | ✅ Zero warnings | ESLint flat-config, max-warnings 0 |
| **Unit tests** | `pnpm test` | ✅ ~240+ cases | All 5 packages pass |
| **Coverage** | `pnpm test:coverage` (each package) | ✅ lines ≥ 90% | All 5 packages meet threshold |
| **No node:test** | `grep -r "node:test\|node:assert" packages/` | Empty | Zero occurrences after migration |
| **No suppressions** | `grep -r "as any\|@ts-ignore\|@ts-nocheck" packages/` | Empty | Baseline maintained at zero |
| **Dev-sandbox parity** | Manual: 4 entry-point modes run identically before/after | ✅ All modes work | `stdio-main.ts`, `http-express-main.ts`, `http-fastify-main.ts`, custom modes |

### 3.1 Verification command sequence

```bash
# Install Vitest globally in workspace
pnpm add -D -w vitest

# Type check all packages
pnpm check-types

# Run all tests
pnpm test

# Coverage per package
pnpm --filter @mcp-auto-expose/core test:coverage
pnpm --filter @mcp-auto-expose/fastify test:coverage
pnpm --filter @mcp-auto-expose/express test:coverage
pnpm --filter @mcp-auto-expose/http test:coverage
pnpm --filter @mcp-auto-expose/stdio test:coverage

# Lint
pnpm lint

# Full build
pnpm build

# Grep checks
grep -r "node:test" packages/ || true  # Should be empty
grep -r "node:assert" packages/ || true  # Should be empty
grep -r "as any" packages/ || true  # Should be empty
grep -r "@ts-ignore" packages/ || true  # Should be empty
grep -r "@ts-nocheck" packages/ || true  # Should be empty
```

### 3.2 Manual dev-sandbox smoke

All 4 entry-point modes (or applicable subset) must run identically before and after:

- `pnpm --filter dev-sandbox tsx src/main.ts` (stdio)
- `pnpm --filter dev-sandbox tsx src/http-express-main.ts` (HTTP + Express)
- `pnpm --filter dev-sandbox tsx src/http-fastify-main.ts` (HTTP + Fastify)
- Custom/additional modes if applicable

Each should:
1. List tools correctly.
2. Invoke at least one tool with success.
3. Output identical JSON structure and results.

---

## 4. Task breakdown and ordering

### Phase 5a — Vitest setup and test conversion (T10)

| Task | Owner | Depends on | Acceptance |
|------|-------|-----------|-----------|
| 5.1. Add `vitest`, `@vitest/coverage-v8` to workspace `devDependencies` | T10 | — | `pnpm list vitest` shows version |
| 5.2. Create `vitest.config.ts` in each of 5 packages | T10 | 5.1 | File exists, `coverage.thresholds.lines = 90` |
| 5.3. Rename `packages/core/src/types.test.ts` → `types.runtime.test.ts` | T10 | 5.2 | File renamed, no broken imports |
| 5.4. Convert 27 test files: replace `node:test`+`node:assert` with `vitest` | T10 | 5.3 | `pnpm test` all green |
| 5.5. Verify `.js`→`.ts` resolution works in Vitest | T10 | 5.4 | Test imports resolve correctly |
| 5.6. Check coverage ≥ 90% in all 5 packages | T10 | 5.4 | `pnpm test:coverage` reports ≥ 90% |
| **Subtotal** | | | All 240+ cases pass |

### Phase 5b — Strict flags activation (T9)

| Task | Owner | Depends on | Acceptance |
|------|-------|-----------|-----------|
| 5.7. Add `noFallthroughCasesInSwitch` to root `tsconfig.json` | T9 | 5.6 | `pnpm check-types` + `pnpm test` green |
| 5.8. Add `noImplicitOverride` to root `tsconfig.json` | T9 | 5.7 | `pnpm check-types` + `pnpm test` green |
| 5.9. Fix break sites (fastify `adaptRouteOptions.ts`, http `createMcpHttp.ts`) | T9 | 5.8 | Code uses conditional spreads, no `!` or `as any` |
| 5.10. Add `exactOptionalPropertyTypes` to root `tsconfig.json` | T9 | 5.9 | `pnpm check-types` + `pnpm test` green |
| 5.11. Add `noPropertyAccessFromIndexSignature` to root `tsconfig.json` | T9 | 5.10 | `pnpm check-types` + `pnpm test` green |
| 5.12. Validate full matrix: build, lint, test, coverage, smoke | T9 | 5.11 | All checks pass |

### Phase 5c — Documentation and CI (optional)

| Task | Owner | Depends on | Acceptance |
|------|-------|-----------|-----------|
| 5.13. Update root README if needed (note Vitest + strict flags) | Async | 5.12 | README reflects new testing story |
| 5.14. Adjust `turbo.json` inputs/outputs if needed | Async | 5.12 | CI passes without extra cache invalidation |

---

## 5. Implementation notes

### 5.1 TypeScript module resolution

Vitest runs in the Node environment with `"type": "module"`. The config block `{ include: ["src/**/*.test.ts"] }` automatically applies to all packages inheriting `tsconfig.json` from `@repo/typescript-config/base.json`. The `.js` → `.ts` resolution is implicit in Vitest's Node loader chain; no special config is needed beyond the standard `vitest.config.ts` above.

### 5.2 Coverage thresholds

Setting `thresholds: { lines: 90 }` in each package's `vitest.config.ts` gates the entire test suite: if coverage drops below 90%, `vitest run --coverage` exits with code 1. This enforces a coverage floor without requiring CI infrastructure changes.

### 5.3 ESLint compatibility

ESLint configurations in each package already support Vitest globals (`describe`, `it`, `expect`, `beforeAll`, etc.) via the `@repo/eslint-config` base. No ESLint config changes needed.

### 5.4 Suppression audit

Before and after the sprint:
- Run `grep -r "as any" packages/ apps/` (should match only documented TS#42192 symbols).
- Run `grep -r "@ts-ignore\|@ts-nocheck" packages/ apps/` (should be empty).
- Run `grep -r "^ *!" packages/ apps/` (should match only documented symbol cases).

If any new suppressions appear, the flag activation is incomplete — fix the underlying type issue instead.

---

## 6. Acceptance criteria (final)

✅ **All 27 test files migrate to Vitest** with no test case loss.
✅ **All ~240+ unit test cases pass** across 5 packages.
✅ **Coverage ≥ 90% (lines)** in all 5 packages.
✅ **4 strict flags enabled** in order: `noFallthroughCasesInSwitch`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`.
✅ **Zero new suppressions** (`as any`, `!`, `@ts-ignore`, `@ts-nocheck`).
✅ **No `node:test` or `node:assert` imports remain** in packages.
✅ **`pnpm build && pnpm lint && pnpm check-types && pnpm test`** all green.
✅ **Dev-sandbox smoke modes work identically** before and after.

---

## 7. Out of scope

- Migrating `apps/dev-sandbox` tests to Vitest (smoke scripts, not part of published packages).
- Adding mocking libraries (`sinon`, `vi.fn()`) — doubles remain hand-written.
- Strict null checks (`strictNullChecks`); that flag has broader implications.
- noUnusedLocals / noUnusedParameters; already enabled in base `tsconfig.json`.
