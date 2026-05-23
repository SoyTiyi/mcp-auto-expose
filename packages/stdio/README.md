# @mcp-auto-expose/stdio

Conecta el catálogo de tools producido por cualquier adaptador `mcp-auto-expose` con un servidor MCP local usando el transporte stdio.

## Uso básico

```ts
import Fastify from "fastify";
import { autoExpose } from "@mcp-auto-expose/fastify";
import { startStdio } from "@mcp-auto-expose/stdio";

const app = Fastify({ logger: { stream: process.stderr } }); // <-- stderr obligatorio
await app.register(autoExpose);

// define tus rutas aquí...

await app.ready();
await startStdio({
  name: "mi-servidor-mcp",
  version: "1.0.0",
  tools: app.mcpAutoExpose.tools(),
});
```

El proceso queda bloqueado escuchando en `stdin`/`stdout` el protocolo JSON-RPC 2.0.

## API

### `startStdio(options): Promise<StartStdioHandle>`

| Opción | Tipo | Default | Descripción |
|--------|------|---------|-------------|
| `name` | `string` | — | Nombre del servidor MCP |
| `version` | `string` | — | Versión del servidor |
| `tools` | `MCPTool[]` | — | Array producido por `app.mcpAutoExpose.tools()` |
| `installGuard` | `boolean` | `true` | Instala el blindaje global `console.*` → stderr |
| `onToolCall` | función | placeholder | Hook para invocación real de tools (ver Fase siguiente) |

**`StartStdioHandle.close()`**: cierra el servidor MCP ordenadamente.

### `installStdoutGuard()` / `restoreStdoutGuard()`

Parcheado global de `console.*` que redirige toda salida a `stderr`, protegiendo la tubería JSON-RPC en `stdout`. Es idempotente. `restoreStdoutGuard()` revierte el estado (útil en tests).

## Restricciones contractuales

### `process.stdout.write` está reservado al protocolo

`StdioServerTransport` del SDK MCP escribe al `stdout` del proceso directamente. El guard NO intercepta `process.stdout.write` — hacerlo destruiría el protocolo. **El código host no debe escribir en `process.stdout` ni en streams que drenen en él.**

### Logger de Fastify

Pino (logger por defecto de Fastify v5) escribe a `stdout` salvo configuración explícita. En modo stdio es **obligatorio** configurarlo hacia `stderr`:

```ts
// Opción 1: stream explícito
const app = Fastify({ logger: { stream: process.stderr } });

// Opción 2: deshabilitar
const app = Fastify({ logger: false });
```

### tools/call

En la Fase 2 `tools/call` devuelve un placeholder estructurado con el método HTTP y URL de destino. La invocación real al handler de Fastify se implementa en una fase posterior (requiere extender `MCPTool._source` con el mapeo flatten → `{params, querystring, body}`).
