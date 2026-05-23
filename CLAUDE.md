# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands run from the repo root via Turbo. Use `--filter` to target a specific app or package.

```sh
pnpm dev                        # start all apps in dev mode
pnpm dev --filter=web           # start only the web app (port 3000)
pnpm build                      # build all apps and packages
pnpm lint                       # lint all packages
pnpm check-types                # type-check all packages
pnpm format                     # format with Prettier
```

To run a command in a single package directly:

```sh
cd apps/web && pnpm lint
cd apps/web && pnpm check-types
```

## Architecture

This is a **pnpm + Turborepo monorepo** with two Next.js 16 apps and three shared packages.

### Apps

- `apps/web` — primary Next.js app (port 3000), uses App Router
- `apps/docs` — documentation Next.js app, uses App Router

### Packages

- `packages/ui` — shared React component library (`@repo/ui`). Components are exported directly from `src/*.tsx` files and consumed as `import { Button } from "@repo/ui/button"`. To generate a new component: `pnpm --filter=@repo/ui generate:component`.
- `packages/eslint-config` — shared ESLint flat configs (`base`, `next`, `react-internal`)
- `packages/typescript-config` — shared `tsconfig.json` bases (`base`, `nextjs`, `react-library`)

### Key conventions

- ESLint is configured in flat-config format (`eslint.config.js`) everywhere; zero warnings allowed (`--max-warnings 0`).
- The `turbo/no-undeclared-env-vars` rule enforces that env vars used in tasks are declared in `turbo.json`.
- Build outputs are `.next/**` (excluding cache). Turbo caches builds; cache is invalidated by `$TURBO_DEFAULT$` inputs plus `.env*` files.
- `apps/web` runs `next typegen` as part of `check-types` — always run `pnpm check-types` (not bare `tsc`) in that package.
