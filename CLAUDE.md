# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project rules (SDD)

- **Fuente de verdad absoluta:** `docs/principal-document.txt`. Consultar SIEMPRE antes de implementar nuevas fases. Cualquier decisión de diseño que contradiga este documento debe rechazarse.
- **Spec-First:** cada fase se documenta en `specs/faseN-<nombre>.md` y se aprueba humanamente antes de escribir código.
- **Spec-Anchored / Spec-as-Source:** los specs permanecen activos en el repo; los cambios de requisitos se hacen primero en el spec.
- **Logs:** todo log/diagnóstico del runtime de la librería debe ir a `stderr` (preparación para transporte stdio MCP). `stdout` queda reservado al protocolo JSON-RPC.
- **Codificación:** UTF-8 estricto sin BOM.

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
cd packages/http && pnpm lint
cd packages/http && pnpm check-types
```

## Architecture

This is a **pnpm + Turborepo monorepo** containing the `@mcp-auto-expose/*` library packages and a development sandbox.

### Apps

- `apps/dev-sandbox` — smoke tests, integration examples, and manual testing scripts (not published)

### Library packages

- `packages/core` — `@mcp-auto-expose/core`: motor de auto-descubrimiento (`generateToolName`, `flattenSchema`, `makeHttpCaller`, `reconstructRequest`, `resolveTool`)
- `packages/fastify` — `@mcp-auto-expose/fastify`: plugin Fastify (`onRoute` hook + `autoExpose`)
- `packages/express` — `@mcp-auto-expose/express`: walker recursivo `app._router.stack` + decoradores `mcpExpose` / `mcpHeader` / `autoExpose`
- `packages/stdio` — `@mcp-auto-expose/stdio`: transporte stdio con `stdoutGuard` (redirige `console.*` → stderr)
- `packages/http` — `@mcp-auto-expose/http`: Streamable HTTP (POST + SSE); binders `mountMcpExpress` / `mcpFastifyPlugin`

### Shared config packages (no publicar)

- `packages/eslint-config` — shared ESLint flat configs (`base`, `react-internal`)
- `packages/typescript-config` — shared `tsconfig.json` bases (`base`, `react-library`)

### Key conventions

- ESLint is configured in flat-config format (`eslint.config.js`) everywhere; zero warnings allowed (`--max-warnings 0`).
- The `turbo/no-undeclared-env-vars` rule enforces that env vars used in tasks are declared in `turbo.json`.
- Build outputs are `dist/**`. Turbo caches builds; cache is invalidated by `$TURBO_DEFAULT$` inputs plus `.env*` files.
- Tests live alongside source files as `*.test.ts` and run via `node --import tsx --test`.
