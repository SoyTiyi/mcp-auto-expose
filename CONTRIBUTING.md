# Guía de Contribución

¡Gracias por tu interés en contribuir a `mcp-auto-expose`!

---

## Requisitos previos

- Node.js ≥22
- pnpm ≥10 (instalar con: `npm install -g pnpm`)

---

## Setup local

```sh
git clone https://github.com/SoyTiyi/mcp-auto-expose.git
cd mcp-auto-expose
pnpm install
pnpm build
```

## Verificar que todo funciona

```sh
pnpm lint            # lint con --max-warnings 0
pnpm check-types     # type check incluyendo apps/dev-sandbox
pnpm test            # ≥140 tests deben pasar
```

---

## Estructura del monorepo

```
mcp-auto-expose/
├── packages/
│   ├── core/        # @mcp-auto-expose/core — motor de auto-descubrimiento
│   ├── fastify/     # @mcp-auto-expose/fastify — plugin Fastify (onRoute hook)
│   ├── express/     # @mcp-auto-expose/express — walker recursivo + decoradores
│   ├── stdio/       # @mcp-auto-expose/stdio — transporte stdio con stdoutGuard
│   └── http/        # @mcp-auto-expose/http — Streamable HTTP (POST+SSE)
├── apps/
│   └── dev-sandbox/ # app de prueba que compone los paquetes (no se publica)
└── packages/
    ├── eslint-config/       # configuración ESLint compartida
    └── typescript-config/   # tsconfig bases compartidas
```

- Todo el código de la librería vive en `packages/`.
- `apps/dev-sandbox` es la referencia viva: compone los adaptadores y transportes
  para validar que todo funciona junto. Los cambios en `packages/` deben seguir
  pasando el smoke test del sandbox.

---

## Hacer cambios

1. Crear una rama: `git checkout -b feat/mi-feature`
2. Hacer los cambios en `packages/`
3. Añadir o actualizar tests en el mismo paquete (`*.test.ts` junto al source)
4. Verificar que el dev-sandbox sigue funcionando (smoke test stdio):

   ```sh
   printf '%s\n%s\n' \
     '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
     '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
   | pnpm --filter dev-sandbox exec node --import tsx src/main.ts \
     2>sandbox.stderr.log
   ```

   La salida en stdout debe contener dos líneas JSON-RPC:
   1. Respuesta `initialize` con `serverInfo.name: "dev-sandbox"` y `capabilities.tools: {}`.
   2. Respuesta `tools/list` con 3 tools: `list_users`, `get_users_by_id`, `create_users`.

5. Ejecutar la suite completa:

   ```sh
   pnpm build && pnpm test && pnpm lint && pnpm check-types
   ```

---

## Crear un changeset (obligatorio para cambios visibles al usuario)

```sh
pnpm changeset
```

→ Seleccionar los paquetes afectados  
→ Elegir el tipo de bump (`patch` / `minor` / `major`)  
→ Escribir un resumen en inglés del cambio (aparecerá en el CHANGELOG)

### ¿Cuándo es obligatorio un changeset?

- Nueva feature o comportamiento
- Bug fix en una API pública
- Breaking change (siempre `major`)

### ¿Cuándo NO hace falta?

- Cambios en tests o docs
- Refactors internos sin cambio de API
- Cambios en CI/configuración

---

## Convención de commits

```
feat: nueva feature
fix: bug fix
docs: solo documentación
chore: tooling, CI, deps
refactor: refactor sin cambio de API
test: tests
```

Para breaking changes, añadir en el cuerpo del commit:

```
BREAKING CHANGE: descripción del cambio incompatible
```

---

## Pull Requests

- Un solo PR por feature/fix
- El título del PR debe seguir la misma convención de commits
- Si el PR tiene breaking changes, incluirlos en el changeset como `major`
- Un maintainer revisará en ≤5 días hábiles

---

## Para maintainers: proceso de release

1. Mergear PRs con changesets
2. GitHub Actions abre automáticamente un "Version Packages" PR
3. Revisar el CHANGELOG generado, ajustar si es necesario
4. Mergear el "Version Packages" PR → los paquetes se publican a npm automáticamente

Para el primer release: configurar `NPM_TOKEN` en GitHub Actions Secrets
(Settings → Secrets and variables → Actions → New repository secret).
