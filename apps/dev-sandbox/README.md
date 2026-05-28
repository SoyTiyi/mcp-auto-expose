# dev-sandbox

Aplicación de prueba que compone el adaptador Fastify de la Fase 1 con el transporte stdio de la Fase 2.

## Uso

```sh
# Desde la raíz del monorepo:
pnpm --filter dev-sandbox dev
```

El proceso queda escuchando en `stdin`. Cualquier cliente MCP puede conectarse lanzándolo como subproceso.

## Verificación smoke manual

```sh
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| pnpm --filter dev-sandbox exec node --import tsx src/main.ts \
  2>sandbox.stderr.log
```

**Salida esperada en stdout** (dos líneas JSON-RPC):

1. Respuesta `initialize` con `serverInfo.name: "dev-sandbox"` y `capabilities.tools: {}`.
2. Respuesta `tools/list` con 3 tools: `list_users`, `get_users_by_id`, `create_users`.

**Verificación del blindaje stdout** — cualquier `console.log` que el código host emita **antes** de `startStdio()` escapa al stdout. Después de que `startStdio()` instala el guard, todo `console.*` se redirige a stderr. Para comprobarlo:

```sh
# Añadir console.log("RUIDO") en main.ts DESPUÉS de await startStdio(...)
# y verificar que stdout no contiene "RUIDO" pero sandbox.stderr.log sí.
```

## Nota sobre Fastify logger

En contexto stdio, el logger de Fastify debe apuntar a `stderr`:

```ts
const app = Fastify({ logger: { stream: process.stderr } });
// o deshabilitar completamente:
const app = Fastify({ logger: false });
```

Pino escribe a `stdout` por defecto — no hacerlo contaminaría la tubería JSON-RPC.
