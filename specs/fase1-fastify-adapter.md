# Fase 1 — Motor de Auto-Descubrimiento (Adaptador Fastify)

> **Estatus:** Especificación pendiente de aprobación humana. Metodología: Spec-Driven Development.
> **Anclaje:** `docs/principal-document.txt` §27–§45, §170–§176.
> **Fecha:** 2026-05-22.

## 1. Objetivo

Construir el módulo TypeScript que se engancha al ciclo de vida de Fastify, intercepta cada definición de ruta en tiempo de registro, extrae sus JSON Schemas y los traduce determinísticamente al contrato `Tool` del Model Context Protocol. El módulo deja en memoria un **registro de tools** que las fases posteriores (3 y 5) consumirán e inyectarán en el servidor MCP.

**Fuera de alcance de Fase 1:**

- Despachar invocaciones del LLM hacia el handler real de Fastify (Fase 3+).
- Servidor MCP stdio (Fase 3).
- Adaptador Express (Fase 4).
- Servidor MCP Streamable HTTP, SEP-2243, SEP-2549, SEP-414 (Fase 5).

## 2. Arquitectura

```
+-------------------+      onRoute       +-------------------+
| Aplicación host   | -----------------> | autoExpose plugin |
| (Fastify v5)      |  routeOptions      | (packages/fastify)|
+-------------------+                    +---------+---------+
                                                   |
                                                   v
                                         +-------------------+
                                         | Mismatch Resolver |
                                         | (packages/core)   |
                                         +---------+---------+
                                                   |
                                                   v   MCPTool
                                         +-------------------+
                                         | ToolRegistry      |
                                         | (packages/core)   |
                                         +-------------------+
```

### 2.1. Paquetes a crear

- `packages/core` → `@mcp-auto-expose/core`
  - Tipos públicos: `MCPTool`, `MCPToolInputSchema`, `RouteDescriptor`, `HTTPMethod`.
  - Funciones puras: `resolveTool(descriptor): MCPTool`, `generateToolName(method, url)`, `flattenSchema(routeSchema)`.
  - `ToolRegistry`: `register(tool)`, `list(): MCPTool[]`, `clear()`. Detección de colisiones con log a `stderr`.
- `packages/fastify` → `@mcp-auto-expose/fastify`
  - Plugin Fastify (envuelto con `fastify-plugin`): `autoExpose(options?)`.
  - Engancha `addHook('onRoute')` global y delega en `core`.
  - Decora la instancia con `mcpAutoExpose.tools()` para inspección.

Ambos paquetes: TypeScript estricto (`@repo/typescript-config/base.json`), `"type": "module"`, `"private": true` hasta una fase de release.

## 3. Diseño técnico detallado

### 3.1. Intercepción con `addHook('onRoute')`

Uso esperado:

```ts
import Fastify from "fastify";
import { autoExpose } from "@mcp-auto-expose/fastify";

const app = Fastify();
await app.register(autoExpose, { strictSchema: false });
// …definir rutas…
await app.ready();
const tools = app.mcpAutoExpose.tools(); // MCPTool[]
```

Internamente:

```ts
fastify.addHook("onRoute", (routeOptions) => {
  for (const descriptor of adaptRouteOptions(routeOptions, options)) {
    const tool = resolveTool(descriptor);
    registry.register(tool);
  }
});
```

`routeOptions` (Fastify v5 `RouteOptions`) entrega:

- `method`: `HTTPMethods | HTTPMethods[]`.
- `url`: string con parámetros `:id` o `{id}`.
- `schema?`: `{ body?, querystring?, params?, response?, headers? }` con JSON Schema.
- `schema.description?`, `schema.summary?`, `schema.tags?`, `schema.hide?`.
- `config?`, `prefix?`, `version?`.

**Reglas determinísticas:**

1. Si `method` es array, se emite **una tool por método**.
2. El `url` ya viene con `prefix` aplicado: se usa tal cual.
3. Si `schema.hide === true` (convención Swagger/OpenAPI), la ruta se omite.
4. Si `config?.mcpExpose === false`, la ruta se omite (escape hatch declarativo).
5. Si `options.strictSchema === true` y la ruta no tiene `schema.body/querystring/params`, la ruta se omite.

### 3.2. Generación de nombre de tool (`generateToolName`)

Determinístico, alineado con el patrón CRUD habitual:

| Método HTTP  | Patrón                          | Entrada                  | Salida                 |
|--------------|---------------------------------|--------------------------|------------------------|
| GET (lista)  | `list_{resource}`               | `GET /api/users`         | `list_users`           |
| GET (item)   | `get_{resource}_by_{param}`     | `GET /api/users/:id`     | `get_users_by_id`      |
| POST         | `create_{resource}`             | `POST /api/users`        | `create_users`         |
| PUT          | `replace_{resource}_by_{param}` | `PUT /api/users/:id`     | `replace_users_by_id`  |
| PATCH        | `update_{resource}_by_{param}`  | `PATCH /api/users/:id`   | `update_users_by_id`   |
| DELETE       | `delete_{resource}_by_{param}`  | `DELETE /api/users/:id`  | `delete_users_by_id`   |
| HEAD/OPTIONS | `{method_lower}_{resource}`     | `OPTIONS /api/users`     | `options_users`        |

**Algoritmo:**

1. Tokenizar `url` por `/`, descartando vacíos.
2. Clasificar segmentos en `static` y `param` (`:id` o `{id}`).
3. `resource = último segmento estático` (snake_case, plural respetado).
4. `params = nombres de parámetros sin `:` ni `{}``.
5. Construir el nombre según la tabla. Si hay >1 param, concatenar con `_and_`.
6. Si el nombre supera 64 caracteres, truncar y añadir `_h<hash6>` (hash determinista del path completo).
7. Si hay colisión en el `ToolRegistry`, añadir sufijo `_2`, `_3`, …; loguear a `stderr`.

### 3.3. Aplanado de schema (`flattenSchema`)

`MCPTool.inputSchema` debe ser **un único objeto JSON Schema con `type: "object"`** que agrupe `params`, `querystring` y `body`:

```ts
function flattenSchema(routeSchema?: FastifyRouteSchema): MCPToolInputSchema {
  const out: MCPToolInputSchema = { type: "object", properties: {}, required: [] };
  if (!routeSchema) return out;

  for (const source of ["params", "querystring", "body"] as const) {
    const sub = routeSchema[source];
    if (!sub) continue;
    if (sub.type !== "object") {
      // body puede ser primitivo o array: se envuelve bajo la clave del source
      out.properties[source] = sub;
      continue;
    }
    for (const [key, propSchema] of Object.entries(sub.properties ?? {})) {
      const finalKey = renameOnCollision(key, source, out.properties);
      out.properties[finalKey] = propSchema;
      if ((sub.required ?? []).includes(key)) out.required.push(finalKey);
    }
  }
  if (out.required.length === 0) delete out.required;
  return out;
}
```

**Anti-colisión de claves**: si el mismo nombre aparece en dos fuentes (raro, p.ej. `id` en params y body), la segunda recibe prefijo `<source>_<key>`. Se loguea a `stderr`.

**`$ref` / definiciones**: en MVP no se resuelven refs cruzadas. Si una subrama incluye `$ref` no resoluble localmente, se loguea warning y la propiedad se omite. (Resolución vía `ajv` queda como trabajo futuro.)

### 3.4. Descripción de la tool

```
description = routeSchema?.description
           ?? routeSchema?.summary
           ?? `${METHOD} ${url} — auto-descubierto por mcp-auto-expose`
```

### 3.5. Contrato `MCPTool` (en `@mcp-auto-expose/core`)

Compatible con `Tool` del `@modelcontextprotocol/sdk`:

```ts
export type HTTPMethod =
  | "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface MCPToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: MCPToolInputSchema;
  // Metadatos NO MCP — uso interno, no se serializan al cliente:
  _source: {
    framework: "fastify" | "express";
    method: HTTPMethod;
    url: string;
  };
}
```

`_source` se preserva para la Fase 3 (reconstrucción de la llamada HTTP en el invocador).

## 4. Estructura de archivos

```
packages/
├── core/
│   ├── package.json
│   ├── tsconfig.json
│   ├── eslint.config.mjs
│   └── src/
│       ├── index.ts             # barrel de exports públicos
│       ├── types.ts             # MCPTool, MCPToolInputSchema, RouteDescriptor, HTTPMethod
│       ├── resolveTool.ts       # Resolver principal
│       ├── toolName.ts          # generateToolName
│       ├── flattenSchema.ts     # flattenSchema + renameOnCollision
│       └── registry.ts          # ToolRegistry
└── fastify/
    ├── package.json
    ├── tsconfig.json
    ├── eslint.config.mjs
    └── src/
        ├── index.ts             # barrel
        ├── plugin.ts            # autoExpose plugin (fastify-plugin)
        └── adaptRouteOptions.ts # routeOptions de Fastify → RouteDescriptor[]
```

### 4.1. `packages/core/package.json` (esqueleto)

```json
{
  "name": "@mcp-auto-expose/core",
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

### 4.2. `packages/fastify/package.json` (esqueleto)

```json
{
  "name": "@mcp-auto-expose/fastify",
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
  "peerDependencies": { "fastify": "^5.0.0" },
  "dependencies": {
    "@mcp-auto-expose/core": "workspace:*",
    "fastify-plugin": "^5.0.0"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/node": "^22.15.3",
    "eslint": "^9.39.1",
    "fastify": "^5.0.0",
    "tsx": "^4.19.2",
    "typescript": "5.9.2"
  }
}
```

`turbo.json` recibirá una task `test` y se ajustarán `outputs` de `build` para incluir `dist/**`.

## 5. Plan de tareas (numeradas, TDD obligatorio)

> Cada tarea sigue rojo → verde → commit. Logs a `stderr` siempre.

### Tarea 1 — Andamiar `packages/core`

- 1.1. Crear `packages/core/package.json`, `tsconfig.json`, `eslint.config.mjs`, `src/index.ts` vacío.
- 1.2. `pnpm install`; verificar `pnpm --filter @mcp-auto-expose/core check-types`.
- 1.3. Commit: `chore(core): scaffold @mcp-auto-expose/core package`.

### Tarea 2 — Tipos públicos en `core`

- 2.1. Test rojo: `src/types.test.ts` (asserts type-level sobre la forma de `MCPTool`).
- 2.2. Implementar `src/types.ts` con `MCPTool`, `MCPToolInputSchema`, `RouteDescriptor`, `HTTPMethod`.
- 2.3. Verde + commit: `feat(core): public types for MCP tool contract`.

### Tarea 3 — `generateToolName`

- 3.1. Tests rojos en `src/toolName.test.ts` cubriendo la tabla §3.2, truncado a 64 chars, y colisión.
- 3.2. Implementar `src/toolName.ts`.
- 3.3. Verde + commit: `feat(core): deterministic tool name generator`.

### Tarea 4 — `flattenSchema`

- 4.1. Tests rojos: schema ausente, `params` + `body`, colisión de claves, body primitivo (envuelto), `$ref` no resoluble (warn + skip).
- 4.2. Implementar `src/flattenSchema.ts` con helper `renameOnCollision`.
- 4.3. Verde + commit: `feat(core): flatten Fastify schemas to flat MCP inputSchema`.

### Tarea 5 — `ToolRegistry`

- 5.1. Tests rojos: `register` duplicado (sufijo + log stderr), `list` ordenado, `clear`.
- 5.2. Implementar `src/registry.ts`.
- 5.3. Verde + commit: `feat(core): tool registry with collision logging to stderr`.

### Tarea 6 — `resolveTool` (composición)

- 6.1. Tests rojos: `RouteDescriptor` → `MCPTool` end-to-end (con/sin schema, multi-método, hide).
- 6.2. Implementar `src/resolveTool.ts` integrando Tareas 3 + 4 + §3.4.
- 6.3. Verde + commit: `feat(core): resolveTool orchestrator (Impedance Mismatch Resolver)`.

### Tarea 7 — Andamiar `packages/fastify`

- 7.1. Crear `packages/fastify/package.json`, `tsconfig.json`, `eslint.config.mjs`, `src/index.ts` vacío.
- 7.2. `pnpm install`; verificar check-types.
- 7.3. Commit: `chore(fastify): scaffold @mcp-auto-expose/fastify package`.

### Tarea 8 — `adaptRouteOptions`

- 8.1. Tests rojos: `RouteOptions` con `method: string[]` → varios `RouteDescriptor`; `schema.hide` → skip; `config.mcpExpose === false` → skip.
- 8.2. Implementar `src/adaptRouteOptions.ts`.
- 8.3. Verde + commit: `feat(fastify): adapt routeOptions to RouteDescriptor`.

### Tarea 9 — Plugin `autoExpose`

- 9.1. Test rojo integración: Fastify + plugin + 3 rutas CRUD con schema; `await app.ready()` → snapshot de `app.mcpAutoExpose.tools()`.
- 9.2. Implementar `src/plugin.ts` (envuelto con `fastify-plugin`; decora la instancia; engancha `onRoute`).
- 9.3. Test rojo: ruta sin schema → tool con `inputSchema: {type:"object",properties:{}}`. Verde.
- 9.4. Test rojo: `strictSchema: true` → ruta sin schema NO se registra. Verde.
- 9.5. Commit: `feat(fastify): autoExpose plugin with onRoute hook integration`.

### Tarea 10 — Documentación de uso y verificación end-to-end

- 10.1. README mínimo en cada paquete con snippet de uso.
- 10.2. `pnpm --filter @mcp-auto-expose/fastify test` debe pasar.
- 10.3. Commit: `docs: usage snippets for fastify adapter and core`.

## 6. Verificación de aceptación

Tras completar las 10 tareas, este smoke test debe correr y emitir 3 tools coherentes:

```ts
// scripts/smoke-fase1.ts
import Fastify from "fastify";
import { autoExpose } from "@mcp-auto-expose/fastify";

const app = Fastify();
await app.register(autoExpose);

app.get("/api/users", { schema: { description: "Listar usuarios" } }, async () => []);
app.get("/api/users/:id", {
  schema: {
    description: "Obtener usuario por id",
    params: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
}, async () => ({}));
app.post("/api/users", {
  schema: {
    description: "Crear usuario",
    body: {
      type: "object",
      properties: { name: { type: "string" }, email: { type: "string" } },
      required: ["name", "email"],
    },
  },
}, async () => ({}));

await app.ready();
process.stderr.write(JSON.stringify(app.mcpAutoExpose.tools(), null, 2));
```

Salida esperada:

- 3 tools: `list_users`, `get_users_by_id`, `create_users`.
- `get_users_by_id.inputSchema.properties.id.type === "string"`, `required: ["id"]`.
- `create_users.inputSchema.properties.{name,email}`, `required: ["name","email"]`.
- Toda salida de diagnóstico viaja por `stderr`.

Comandos de verificación:

```sh
pnpm install
pnpm --filter @mcp-auto-expose/core check-types
pnpm --filter @mcp-auto-expose/core test
pnpm --filter @mcp-auto-expose/fastify check-types
pnpm --filter @mcp-auto-expose/fastify test
pnpm lint
node --import tsx scripts/smoke-fase1.ts 2>tools.json
```

## 7. Notas y decisiones explícitas

- **Logs**: `console.warn`/`console.log` defensivos del adaptador siempre por `stderr` (`console.error` o `process.stderr.write`).
- **UTF-8**: archivos sin BOM.
- **TypeScript strict**: `noUncheckedIndexedAccess` heredado, no se relaja.
- **Fuera de Fase 1**: invocar tools, transport stdio/HTTP, OAuth, observabilidad W3C Trace Context, caché `ttlMs`, adaptador Express, SEP-2243/2549/414.

---

**Punto de control**: una vez aprobado este documento, las Tareas 1–10 se ejecutarán secuencialmente.
