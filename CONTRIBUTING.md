# Contributing Guide

Thank you for your interest in contributing to `mcp-auto-expose`!

---

## Prerequisites

- Node.js ≥22
- pnpm ≥10 (install with: `npm install -g pnpm`)

---

## Local Setup

```sh
git clone https://github.com/SoyTiyi/mcp-auto-expose.git
cd mcp-auto-expose
pnpm install
pnpm build
```

## Verify Everything Works

```sh
pnpm lint            # lint with --max-warnings 0
pnpm check-types     # type check including apps/dev-sandbox
pnpm test            # ≥140 tests must pass
```

---

## Monorepo Structure

```
mcp-auto-expose/
├── packages/
│   ├── core/        # @mcp-auto-expose/core — auto-discovery engine
│   ├── fastify/     # @mcp-auto-expose/fastify — Fastify plugin (onRoute hook)
│   ├── express/     # @mcp-auto-expose/express — recursive walker + decorators
│   ├── stdio/       # @mcp-auto-expose/stdio — stdio transport with stdoutGuard
│   └── http/        # @mcp-auto-expose/http — Streamable HTTP (POST+SSE)
├── apps/
│   └── dev-sandbox/ # test app that composes all packages (not published)
└── packages/
    ├── eslint-config/       # shared ESLint configuration
    └── typescript-config/   # shared tsconfig bases
```

- All library code lives in `packages/`.
- `apps/dev-sandbox` is the living reference: it composes the adapters and transports
  to validate that everything works together. Changes in `packages/` must continue
  passing the sandbox smoke test.

---

## Making Changes

1. Create a branch: `git checkout -b feat/my-feature`
2. Make changes in `packages/`
3. Add or update tests in the same package (`*.test.ts` next to the source)
4. Verify the dev-sandbox still works (stdio smoke test):

   ```sh
   printf '%s\n%s\n' \
     '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
     '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
   | pnpm --filter dev-sandbox exec node --import tsx src/main.ts \
     2>sandbox.stderr.log
   ```

   stdout must contain two JSON-RPC lines:
   1. `initialize` response with `serverInfo.name: "dev-sandbox"` and `capabilities.tools: {}`.
   2. `tools/list` response with 3 tools: `list_users`, `get_users_by_id`, `create_users`.

5. Run the full suite:

   ```sh
   pnpm build && pnpm test && pnpm lint && pnpm check-types
   ```

---

## Creating a Changeset (required for user-visible changes)

```sh
pnpm changeset
```

→ Select the affected packages
→ Choose the bump type (`patch` / `minor` / `major`)
→ Write a summary of the change (will appear in the CHANGELOG)

### When is a changeset required?

- New feature or behaviour
- Bug fix in a public API
- Breaking change (always `major`)

### When is it NOT required?

- Test or docs changes
- Internal refactors with no API change
- CI/configuration changes

---

## Commit Convention

```
feat: new feature
fix: bug fix
docs: documentation only
chore: tooling, CI, deps
refactor: refactor with no API change
test: tests
```

For breaking changes, add to the commit body:

```
BREAKING CHANGE: description of the incompatible change
```

---

## Pull Requests

- One PR per feature/fix
- The PR title must follow the same commit convention
- If the PR has breaking changes, include them in the changeset as `major`
- A maintainer will review within ≤5 business days

---

## For Maintainers: Release Process

1. Merge PRs with changesets
2. GitHub Actions automatically opens a "Version Packages" PR
3. Review the generated CHANGELOG, adjust if needed
4. Merge the "Version Packages" PR → packages are published to npm automatically

For the first release: configure `NPM_TOKEN` in GitHub Actions Secrets
(Settings → Secrets and variables → Actions → New repository secret).
