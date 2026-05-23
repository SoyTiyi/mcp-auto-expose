# Fase 2 — Transporte stdio + Instanciación del Servidor MCP

> **Estatus:** Especificación aprobada — en espera de luz verde para implementación.
> **Metodología:** Spec-Driven Development.
> **Anclaje:** `docs/principal-document.txt` §70–§76 (transporte stdio), §177–§183 (Fase 3 del roadmap), §35 (impedance mismatch resolver).
> **Fecha:** 2026-05-23.

## 1. Objetivo

Conectar la salida del adaptador Fastify de la Fase 1 (`app.mcpAutoExpose.tools(): MCPTool[]`) a una instancia real del servidor MCP usando el transporte local stdio. El proceso resultante expone el catálogo de herramientas via `tools/list` y protege la tubería JSON-RPC stdout de cualquier contaminación por logs del framework huésped.

**Fuera de alcance:**
- Dispatch real de `tools/call` a handlers de Fastify (requiere extender `_source` en core para preservar mapeo flatten→`{params, querystring, body}`). Se implementa en fase posterior.
- Adaptador Express (Fase 4).
- Streamable HTTP, SEP-2243, SEP-2549, SEP-414 (Fase 5).

## 2. Arquitectura

```
apps/dev-sandbox  ── Fastify v5 + autoExpose ──► app.mcpAutoExpose.tools(): MCPTool[]
                                                        │
                                                        ▼
                                          startStdio({ name, version, tools })
                                                        │
                              ┌────────────────────────┴────────────────────────┐
                              │ packages/stdio  (@mcp-auto-expose/stdio)         │
                              │                                                  │
                              │ 1. installStdoutGuard()  ─► console.* → stderr   │
                              │ 2. new McpServer({ name, version })              │
                              │ 3. for each tool: server.registerTool(...)       │
                              │ 4. await server.connect(new StdioServerTransport)│
                              └──────────────────────────────────────────────────┘
                                                        │
                                                        ▼
                                       stdin/stdout = JSON-RPC 2.0 UTF-8
```

### 2.1. Paquetes a crear

- `packages/stdio` → `@mcp-auto-expose/stdio`
  - `stdoutGuard.ts`: blindaje global `console.*` → stderr.
  - `registerTools.ts`: itera `MCPTool[]` y llama `server.registerTool(...)`.
  - `startStdio.ts`: factory pública async.
- `apps/dev-sandbox` — app de prueba que compone Fastify + `autoExpose` + `startStdio`.

## 3. Diseño técnico detallado

### 3.1. API pública de `@mcp-auto-expose/stdio`

```ts
import type { MCPTool } from "@mcp-auto-expose/core";

export interface StartStdioOptions {
  name: string;
  version: string;
  tools: MCPTool[];
  /** Default true. Desactivar sólo en tests aislados. */
  installGuard?: boolean;
  /** Hook opcional. Fase 2 default = placeholder estructurado. */
  onToolCall?: (
    tool: MCPTool,
    args: unknown,
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

export interface StartStdioHandle {
  close(): Promise<void>;
}

export async function startStdio(options: StartStdioOptions): Promise<StartStdioHandle>;
export { installStdoutGuard, restoreStdoutGuard, isStdoutGuardInstalled } from "./stdoutGuard.js";
```

Uso esperado (desde `apps/dev-sandbox`):

```ts
import Fastify from "fastify";
import { autoExpose } from "@mcp-auto-expose/fastify";
import { startStdio } from "@mcp-auto-expose/stdio";

const app = Fastify({ logger: { stream: process.stderr } });
await app.register(autoExpose);
// … definir rutas …
await app.ready();
await startStdio({ name: "dev-sandbox", version: "0.0.0", tools: app.mcpAutoExpose.tools() });
```

### 3.2. Blindaje stdout/stderr (`stdoutGuard.ts`)

**Justificación** (principal-document §75, §183): `stdout` está consagrado exclusivamente al protocolo JSON-RPC. Cualquier `console.log` descarriado destruye silenciosamente la sesión del cliente MCP.

**Estrategia:** parchear los métodos de `console` globalmente; cada uno serializa via `util.format(...args) + "\n"` y escribe a `process.stderr.write`. **No** se parchea `process.stdout.write` porque `StdioServerTransport` del SDK lo usa directamente y reemplazarlo destruiría el protocolo.

Métodos parcheados: `log`, `info`, `warn`, `error`, `debug`, `trace`, `dir`, `group`, `groupCollapsed`, `groupEnd`, `table`, `count`, `countReset`, `time`, `timeLog`, `timeEnd`, `assert`.

**Restricción contractual documentada en README**: el código huésped no debe llamar `process.stdout.write` directamente. Pino (logger por defecto de Fastify v5) escribe a stdout salvo que se configure `logger: { stream: process.stderr }` — esta configuración es obligatoria cuando se usa el transport stdio.

**Firmas:**

```ts
export function installStdoutGuard(): void;   // idempotente
export function restoreStdoutGuard(): void;   // repone originalConsole (para tests)
export function isStdoutGuardInstalled(): boolean;
```

### 3.3. Registro dinámico de tools (`registerTools.ts`)

El SDK MCP TypeScript v1.x expone `fromJsonSchema` para usar JSON Schema plano (sin Zod) como `inputSchema`, lo que encaja exactamente con `MCPToolInputSchema` de `@mcp-auto-expose/core`.

```ts
import { fromJsonSchema } from "@modelcontextprotocol/sdk/server/mcp.js";
// (import path exacto se confirma tras pnpm install según export map del paquete)

export function registerTools({ server, tools, onToolCall }): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: fromJsonSchema(tool.inputSchema),
      },
      async (args) => {
        if (onToolCall) return await onToolCall(tool, args);
        return {
          content: [{
            type: "text",
            text:
              `[fase2-placeholder] tool "${tool.name}" mapea a ` +
              `${tool._source.method} ${tool._source.url}. ` +
              `Invocación real pendiente de fase posterior.`,
          }],
        };
      },
    );
  }
}
```

### 3.4. Factory `startStdio.ts`

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { installStdoutGuard } from "./stdoutGuard.js";
import { registerTools } from "./registerTools.js";

export async function startStdio(options: StartStdioOptions): Promise<StartStdioHandle> {
  if (options.installGuard !== false) installStdoutGuard();

  const server = new McpServer({ name: options.name, version: options.version });
  registerTools({ server, tools: options.tools, onToolCall: options.onToolCall });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return {
    async close() { await server.close(); },
  };
}
```

### 3.5. Estructura de archivos

```
packages/stdio/
├── package.json
├── tsconfig.json
├── eslint.config.mjs
└── src/
    ├── index.ts
    ├── stdoutGuard.ts
    ├── stdoutGuard.test.ts
    ├── registerTools.ts
    ├── registerTools.test.ts
    └── startStdio.ts

apps/dev-sandbox/
├── package.json
├── tsconfig.json
└── src/
    └── main.ts
```

### 3.6. `packages/stdio/package.json`

```json
{
  "name": "@mcp-auto-expose/stdio",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -b",
    "check-types": "tsc --noEmit",
    "lint": "eslint . --max-warnings 0",
    "test": "node --test --import tsx 'src/**/*.test.ts'"
  },
  "dependencies": {
    "@mcp-auto-expose/core": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^22.15.3",
    "eslint": "^9.39.1",
    "tsx": "^4.19.2",
    "typescript": "5.9.2"
  }
}
```

### 3.7. `apps/dev-sandbox/package.json`

```json
{
  "name": "dev-sandbox",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --import tsx src/main.ts",
    "check-types": "tsc --noEmit",
    "lint": "eslint . --max-warnings 0"
  },
  "dependencies": {
    "@mcp-auto-expose/fastify": "workspace:*",
    "@mcp-auto-expose/stdio": "workspace:*",
    "fastify": "^5.0.0"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^22.15.3",
    "eslint": "^9.39.1",
    "tsx": "^4.19.2",
    "typescript": "5.9.2"
  }
}
```

## 4. Plan de tareas (TDD obligatorio: rojo → verde → commit)

### Tarea 1 — Andamiar `packages/stdio`
- 1.1. Crear `package.json`, `tsconfig.json`, `eslint.config.mjs`, `src/index.ts` vacío.
- 1.2. `pnpm install` (resuelve `@modelcontextprotocol/sdk` y lo añade al lockfile).
- 1.3. `pnpm --filter @mcp-auto-expose/stdio check-types`.
- 1.4. Commit: `chore(stdio): scaffold @mcp-auto-expose/stdio package`.

### Tarea 2 — `stdoutGuard`
- 2.1. Tests rojos (`stdoutGuard.test.ts`): `console.log("x")` tras `installStdoutGuard()` no escribe nada a stdout; `restoreStdoutGuard()` repone; `installStdoutGuard()` es idempotente (segunda llamada no duplica el parcheado).
- 2.2. Implementar `stdoutGuard.ts`.
- 2.3. Verde + commit: `feat(stdio): global console guard redirecting to stderr`.

### Tarea 3 — `registerTools`
- 3.1. Tests rojos (`registerTools.test.ts`): mock minimal de `McpServer` con spy en `registerTool`; N tools → N llamadas; cada llamada incluye `name`, `description` e `inputSchema`; el handler placeholder incluye `_source.method` y `_source.url` en el texto.
- 3.2. Implementar `registerTools.ts`.
- 3.3. Verde + commit: `feat(stdio): dynamic tool registration from MCPTool[]`.

### Tarea 4 — `startStdio`
- 4.1. Test ligero con mocks de `McpServer` y `StdioServerTransport`: confirma orden `installStdoutGuard` → `new McpServer` → `registerTools` → `connect`.
- 4.2. Implementar `startStdio.ts`.
- 4.3. Barrel `src/index.ts` con exports públicos.
- 4.4. Verde + commit: `feat(stdio): startStdio factory wiring McpServer + StdioServerTransport`.

### Tarea 5 — Andamiar `apps/dev-sandbox`
- 5.1. Crear `package.json`, `tsconfig.json`, `src/main.ts`.
- 5.2. `pnpm install`.
- 5.3. `pnpm --filter dev-sandbox check-types` verde.
- 5.4. Commit: `chore(dev-sandbox): scaffold sandbox app`.

### Tarea 6 — Smoke end-to-end y documentación
- 6.1. Verificación manual (ver §5.2).
- 6.2. `apps/dev-sandbox/README.md` con instrucciones del smoke.
- 6.3. Commit: `docs(dev-sandbox): stdio smoke test instructions`.

### Tarea 7 — README de `packages/stdio`
- 7.1. Snippet de uso, nota Pino/Fastify, restricción contractual `process.stdout.write`.
- 7.2. Commit: `docs(stdio): usage and stdio safety notes`.

### Tarea 8 — CI/turbo
- 8.1. Verificar si `tsc -b` produce `dist/`. Si sí, añadir `"outputs": ["dist/**"]` a la task `build` en `turbo.json`.
- 8.2. `pnpm lint` global sin warnings.
- 8.3. Commit: `chore(turbo): include dist outputs for @mcp-auto-expose/stdio` (si aplica).

## 5. Verificación de aceptación

### 5.1. Automática

```sh
pnpm install
pnpm --filter @mcp-auto-expose/stdio check-types
pnpm --filter @mcp-auto-expose/stdio test
pnpm --filter dev-sandbox check-types
pnpm lint
```

Todos verdes, cero warnings.

### 5.2. Manual (smoke stdio)

```sh
printf '%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
| pnpm --filter dev-sandbox exec node --import tsx src/main.ts \
  2>sandbox.stderr.log
```

**stdout esperado:** exactamente dos líneas JSON-RPC — la respuesta `initialize` y la respuesta `tools/list` con 3 tools (`list_users`, `get_users_by_id`, `create_users`). Sin ninguna otra línea.

**stderr esperado (`sandbox.stderr.log`):** logs de Pino/Fastify y cualquier diagnóstico del paquete. No contamina stdout.

**Prueba del guard:** insertar un `console.log("ruido")` en `main.ts` antes de `startStdio`. Verificar que stdout sigue siendo JSON-RPC puro y `sandbox.stderr.log` contiene `"ruido"`.

## 6. Notas y decisiones explícitas

- **`tools/call` placeholder**: en Fase 2 el handler retorna texto descriptivo. La implementación real requiere extender `MCPTool._source` en `@mcp-auto-expose/core` con un mapa `originKey → "params"|"querystring"|"body"` para reconsteruir la petición HTTP. Eso es trabajo de una fase posterior.
- **No se modifica `@mcp-auto-expose/core`** ni `@mcp-auto-expose/fastify` en esta fase.
- **Logs**: todo diagnóstico del runtime del paquete usa `process.stderr.write`.
- **UTF-8**: archivos sin BOM.
- **TypeScript strict**: `noUncheckedIndexedAccess` heredado, no se relaja.
- **`pnpm-workspace.yaml`**: ya cubre `packages/*` y `apps/*`; no requiere cambios.

---

**Punto de control**: especificación aprobada. Las Tareas 1–8 se ejecutarán secuencialmente tras la luz verde del operador.
