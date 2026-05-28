# Fase 3 — Motor Analítico y Adaptador para Express.js

> **Estatus:** Especificación pendiente de aprobación humana. Metodología: Spec-Driven Development.
> **Anclaje:** `docs/principal-document.txt` §38–§41 (introspección Express), §184–§191 (Fase 4 del roadmap).
> **Fecha:** 2026-05-23.
> **Predecesoras aprobadas:** Fase 1 (adaptador Fastify), Fase 2 (transporte stdio).

## 1. Objetivo

Construir `@mcp-auto-expose/express` (`packages/express`): motor reflectivo que itera recursivamente `app.router` (v5) / `app._router` (v4) tras el registro de rutas, lee schemas Zod inyectados vía `mcpExpose(spec)` middleware, los convierte a JSON Schema Draft 7, y produce `MCPTool[]` con la **misma forma exacta** que el adaptador Fastify para que el servidor MCP de Fase 2 los consuma sin cambios.

**Fuera de alcance:**

- Dispatch real de `tools/call` a handlers Express (requiere extender `_source` en core; fase posterior).
- Streamable HTTP, SEP-2243, SEP-2549, SEP-414 (Fase 4 nueva).
- Validación HTTP en runtime vía `mcpExpose` (posible extensión futura con flag `validate:true`, fuera de MVP).

## 2. Arquitectura

```
+------------------+   autoExpose(app)    +--------------------------+
| Aplicación host  | -------------------> | packages/express         |
| (Express 4 o 5)  |                      | @mcp-auto-expose/express |
+------------------+                      +-----------+--------------+
        |                                             |
        | app.router (v5)                             |
        | o app._router (v4, lazy)                    | RouteDescriptor[]
        |                                             |
        v                                             v
+------------------+                      +--------------------------+
| walkRoutes()     |  ─── recursivo ────> | resolveTool (core)       |
| + extractSchema  |                      | ToolRegistry (core)      |
+------------------+                      +--------------------------+
        ^                                             |
        |                                             v  MCPTool[]
| app.use('/api', router)                  +--------------------------+
| router.get('/users',                     | startStdio({ tools })    |
|   mcpExpose({ body: z }),   ─────────>   | (packages/stdio)         |
|   handler)                               +--------------------------+
```

### 2.1. Paquetes a crear

- `packages/express` → `@mcp-auto-expose/express`
  - `warn.ts`: helper único de logging a `stderr` con prefijo `[mcp-auto-expose:express]`.
  - `zodConvert.ts`: `convertCached(schema)` — Zod → JSON Schema Draft 7 con WeakMap cache.
  - `mcpExpose.ts`: `mcpExpose(spec): RequestHandler`, `MCP_EXPOSE_SYMBOL`, `specToRouteSchema`.
  - `walkRoutes.ts`: walker recursivo + helpers `joinPath`, `methodsOf`, `recoverMountPath`, `extractSchema`.
  - `autoExpose.ts`: `autoExpose(app, options?)` factory — `AutoExposeHandle` con `tools()` lazy+memoized y `refresh()`.
  - `src/index.ts`: barrel de exports públicos.

- `apps/dev-sandbox/src/express-main.ts` — nuevo entry-point de smoke (no modifica `main.ts` existente).

### 2.2. Sin cambios en `@mcp-auto-expose/core`

`RouteDescriptor.framework: "fastify" | "express"` ya soporta Express en `packages/core/src/types.ts:26-31`. `RouteSchema` ya cubre `{body?, querystring?, params?, description?, summary?, tags?, hide?}`. `resolveTool` y `ToolRegistry` se reutilizan sin modificación.

## 3. Diseño técnico detallado

### 3.1. API pública de `@mcp-auto-expose/express`

```ts
// packages/express/src/index.ts
import type { Express } from "express";
import type { MCPTool } from "@mcp-auto-expose/core";

export interface AutoExposeOptions {
  /**
   * Default: true (opt-in).
   * Solo rutas con mcpExpose() son expuestas.
   * NOTA: diverge de Fastify (default false) por postura de seguridad —
   * Express es frecuente en apps legacy donde la exposición accidental de
   * endpoints admin es un riesgo concreto.
   */
  strictSchema?: boolean;
  /**
   * Default: false (lazy).
   * Si true, el walker corre en autoExpose() en lugar de en tools().
   * Útil para detectar errores de configuración en bootstrap.
   */
  eager?: boolean;
  /**
   * Prefijo URL a stripear de los descriptores antes de la generación de nombre.
   * Ej: basePath: "/api" → GET /api/users se registra como GET /users → list_users.
   */
  basePath?: string;
}

export interface AutoExposeHandle {
  /** Walk lazy + memoized. Idempotente. */
  tools(): MCPTool[];
  /** Re-walk forzado: limpia ToolRegistry y reconstruye el catálogo. */
  refresh(): MCPTool[];
}

export function autoExpose(app: Express, options?: AutoExposeOptions): AutoExposeHandle;
export { mcpExpose } from "./mcpExpose.js";
export type { McpExposeSpec } from "./mcpExpose.js";
export { MCP_EXPOSE_SYMBOL } from "./mcpExpose.js";
```

**Uso esperado (desde `apps/dev-sandbox/src/express-main.ts`):**

```ts
import express from "express";
import { z } from "zod";
import { autoExpose, mcpExpose } from "@mcp-auto-expose/express";
import { startStdio } from "@mcp-auto-expose/stdio";

const app = express();
app.use(express.json());

const router = express.Router();

router.get("/users", mcpExpose({ description: "Listar usuarios" }), async (_req, res) =>
  res.json([]),
);

router.get(
  "/users/:id",
  mcpExpose({
    params: z.object({ id: z.string() }),
    description: "Obtener usuario por id",
  }),
  async (_req, res) => res.json({}),
);

router.post(
  "/users",
  mcpExpose({
    body: z.object({ name: z.string(), email: z.string() }),
    description: "Crear usuario",
  }),
  async (_req, res) => res.status(201).json({}),
);

app.use("/api", router);

const handle = autoExpose(app, { strictSchema: true });
await startStdio({ name: "express-sandbox", version: "0.0.0", tools: handle.tools() });
```

### 3.2. `mcpExpose` — middleware decorador (pure metadata carrier)

```ts
// packages/express/src/mcpExpose.ts
import type { RequestHandler } from "express";
import type { RouteSchema } from "@mcp-auto-expose/core";
import { z } from "zod";
import { specToRouteSchema } from "./zodConvert.js";

export const MCP_EXPOSE_SYMBOL: unique symbol = Symbol.for("mcp-auto-expose.schema");

export interface McpExposeSpec {
  body?: z.ZodTypeAny;
  /**
   * Nombre Express-idiomático para query parameters.
   * Se mapea internamente a RouteSchema.querystring (contrato de core.flattenSchema).
   */
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  description?: string;
  summary?: string;
  tags?: string[];
  /** Si true, la ruta se omite del catálogo MCP (opt-out por ruta). */
  hide?: boolean;
}

export function mcpExpose(spec: McpExposeSpec): RequestHandler {
  const routeSchema = specToRouteSchema(spec); // conversión en registration time
  const middleware: RequestHandler = (_req, _res, next) => next(); // no-op en runtime
  (middleware as unknown as Record<symbol, RouteSchema>)[MCP_EXPOSE_SYMBOL] = routeSchema;
  return middleware;
}
```

**Decisiones y justificaciones:**

- **`Symbol.for("mcp-auto-expose.schema")`**: el registro global de símbolos garantiza que la misma key sea reconocida incluso si el paquete aparece dos veces en el árbol de módulos (dual-bundle, npm dedupe quirks). Un WeakMap exportado fallaría silenciosamente en ese escenario. Una string key colisionaría con código userland. El símbolo es no enumerable en `Object.keys` y `JSON.stringify`, evitando leaks en logs.

- **`next()` puro**: cero coste en hot path. La validación HTTP queda al usuario (zod-express-middleware, `.parse()` manual). No hay flag `validate` en esta fase — si se añade en el futuro, es retrocompatible.

- **Tipo `RequestHandler`**: el middleware retornado type-checks sin casts para el usuario en `app.get(path, mcpExpose({...}), handler)`.

- **Conversión en registration time**: `specToRouteSchema` (que llama `zodToJsonSchema`) corre una sola vez cuando el usuario llama `mcpExpose(...)`, no en cada request ni en el walk. El resultado se almacena en el símbolo del middleware.

### 3.3. Conversión Zod → JSON Schema Draft 7 (`zodConvert.ts`)

```ts
// packages/express/src/zodConvert.ts
import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";
import type { RouteSchema } from "@mcp-auto-expose/core";
import type { McpExposeSpec } from "./mcpExpose.js";
import { warn } from "./warn.js";

const conversionCache = new WeakMap<z.ZodTypeAny, Record<string, unknown>>();

function convertCached(schema: z.ZodTypeAny): Record<string, unknown> {
  const cached = conversionCache.get(schema);
  if (cached) return cached;

  let out: Record<string, unknown>;
  try {
    out = zodToJsonSchema(schema, {
      target: "jsonSchema7", // MCP Tool.inputSchema requiere Draft 7
      $refStrategy: "none", // core.flattenSchema dropea $ref; inlinear evita pérdida
      // NO pasar name: dispara wrapper $ref/#/definitions que sería droppeado
    }) as Record<string, unknown>;
  } catch (e) {
    warn("zod-convert-failed", { message: String(e) });
    out = {};
  }

  if (JSON.stringify(out).includes('"$ref"')) {
    warn("schema-has-ref", { hint: "usa z.object plano; schemas recursivos se simplifican a {}" });
  }

  conversionCache.set(schema, out);
  return out;
}

export function specToRouteSchema(spec: McpExposeSpec): RouteSchema {
  return {
    body: spec.body ? convertCached(spec.body) : undefined,
    querystring: spec.query ? convertCached(spec.query) : undefined, // rename query→querystring
    params: spec.params ? convertCached(spec.params) : undefined,
    description: spec.description,
    summary: spec.summary,
    tags: spec.tags ? [...spec.tags] : undefined, // shallow copy
    hide: spec.hide,
  };
}
```

**Justificación de las opciones de conversión:**

| Opción         | Valor           | Por qué                                                                                                                     |
| -------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `target`       | `"jsonSchema7"` | Clientes MCP esperan Draft 7; Draft 2019-09 incluye `unevaluatedProperties` y otros constructs no universalmente soportados |
| `$refStrategy` | `"none"`        | `core/flattenSchema.ts:30-40` dropea propiedades con `$ref`; `"none"` inlinea todo eliminando la pérdida                    |
| `name`         | no pasar        | Dispara wrapper `$ref/#/definitions/<name>` que `flattenSchema` dropearía completo                                          |

**Comportamiento de edge cases:**

| Input Zod                      | Output JSON Schema                                                             | Comportamiento en `core.flattenSchema`                   |
| ------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `z.object({ id: z.string() })` | `{ type: "object", properties: { id: { type: "string" } }, required: ["id"] }` | Aplanado normal en `inputSchema`                         |
| `z.string()` (body primitivo)  | `{ type: "string" }`                                                           | Envuelto bajo `properties.body` (flattenSchema.ts:15-18) |
| `z.array(z.number())`          | `{ type: "array", items: { type: "number" } }`                                 | Envuelto bajo source key                                 |
| `z.discriminatedUnion(...)`    | `{ anyOf: [...] }` (sin `type: "object"`)                                      | Envuelto; warning en stderr                              |
| `z.lazy(...)` con ciclo        | `{}` (any)                                                                     | Acepta cualquier cosa; warning                           |

**Memoización**: WeakMap keyed por identidad del Zod schema. El mismo `z.object({...})` usado en 50 rutas se convierte una sola vez. Correctamente identity-based: dos instancias con misma forma no comparten cache (comportamiento correcto).

### 3.4. Walker recursivo — `walkRoutes.ts`

#### Tipos internos (no exportados)

```ts
type ExpressLayer = {
  name?: string;
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
    stack: Array<{ handle: unknown; name?: string }>;
  };
  handle?: { stack?: ExpressLayer[] } & ((...a: unknown[]) => void);
  regexp?: RegExp & { fast_slash?: boolean };
  path?: string; // Express 5 en layers de sub-router montado
};
```

#### Entry point

```ts
// packages/express/src/walkRoutes.ts
import type { Express } from "express";
import type { RouteDescriptor, RouteSchema } from "@mcp-auto-expose/core";
import { MCP_EXPOSE_SYMBOL } from "./mcpExpose.js";
import type { AutoExposeOptions } from "./autoExpose.js";
import { warn } from "./warn.js";

function getRootStack(app: Express): ExpressLayer[] {
  const a = app as unknown as {
    router?: { stack: ExpressLayer[] };
    _router?: { stack: ExpressLayer[] };
    lazyrouter?: () => void;
  };
  if (a.router?.stack) return a.router.stack; // Express 5: getter lazy público
  if (typeof a.lazyrouter === "function") a.lazyrouter(); // Express 4: forzar lazy init
  if (a._router?.stack) return a._router.stack; // Express 4: después de init
  warn("empty-router", {});
  return [];
}

export function walkRoutes(app: Express, opts: AutoExposeOptions): RouteDescriptor[] {
  const out: RouteDescriptor[] = [];
  const seen = new Set<string>();
  const basePath = opts.basePath ?? "";
  walk(getRootStack(app), basePath, out, seen, opts);
  return out;
}
```

#### Recursión

```ts
function walk(
  stack: ExpressLayer[],
  mountPath: string,
  out: RouteDescriptor[],
  seen: Set<string>,
  opts: AutoExposeOptions,
): void {
  for (const layer of stack) {
    if (layer.route) {
      // Terminal: ruta registrada directamente en esta capa
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];

      for (const p of paths) {
        const url = joinPath(mountPath, p);
        const verbs = methodsOf(layer.route.methods, url);

        for (const verb of verbs) {
          const key = `${verb} ${url}`;
          if (seen.has(key)) {
            warn("duplicate", { verb, url });
            continue;
          }
          seen.add(key);

          const schema = extractSchema(layer.route.stack);

          if (opts.strictSchema !== false && !schema) {
            // strictSchema default: true (diferente a Fastify)
            warn("missing-schema-strict", { verb, url });
            continue;
          }
          if (schema?.hide) continue; // opt-out silencioso

          out.push({ framework: "express", method: verb, url, schema });
        }
      }
    } else if (layer.name === "router" && layer.handle) {
      // Sub-router: descender recursivamente
      const subStack = (layer.handle as { stack?: ExpressLayer[] }).stack;
      if (!subStack) {
        warn("malformed-router-layer", { mountPath });
        continue;
      }

      const childMount = recoverMountPath(layer, mountPath);
      walk(subStack, joinPath(mountPath, childMount), out, seen, opts);
    }
    // Cualquier otro middleware (body-parser, cors, etc.) → ignorar
  }
}
```

#### Sub-rutinas

```ts
// Colapsa dobles slashes, preserva :param y wildcards Express verbatim.
// No añade trailing slash (excepto si el resultado es exactamente "/").
function joinPath(parent: string, child: string): string {
  const raw = `${parent}/${child}`.replace(/\/+/g, "/");
  return raw.length > 1 ? raw.replace(/\/$/, "") : raw;
}

// Extrae verbos HTTP del mapa methods. Filtra _all y verbos fuera del union HTTPMethod.
function methodsOf(methods: Record<string, boolean>, url: string): HTTPMethod[] {
  const VALID: ReadonlySet<string> = new Set([
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
  ]);
  return Object.keys(methods)
    .filter((m) => methods[m] && m !== "_all")
    .map((m) => m.toUpperCase())
    .filter((m): m is HTTPMethod => {
      if (VALID.has(m)) return true;
      warn("unknown-method", { verb: m, url });
      return false;
    });
}

// Recupera el prefijo de montaje de una layer de tipo router.
// Express 5: layer.path; Express 4: regex parsing (patrón canónico).
function recoverMountPath(layer: ExpressLayer, parentMount: string): string {
  if (layer.path && typeof layer.path === "string") return layer.path; // Express 5

  const regexp = layer.regexp;
  if (!regexp) return "";
  if (regexp.fast_slash) return ""; // montado en "/"

  // Patrón canónico (express-list-endpoints):
  const match = /^\^\\\/(?:\(\?:\(\[\^\\\/]\+\?\)\))?(.*?)\\\/\?\(\?=\\\/\|\$\)/i.exec(
    regexp.source,
  );
  if (match?.[1]) {
    return `/${match[1].replace(/\\\//g, "/")}`;
  }

  warn("regex-parse-failed", { source: regexp.source, parentMount });
  return ""; // graceful degradation: descendants surfacen bajo mountPath padre
}

// Busca el primer middleware tagged con MCP_EXPOSE_SYMBOL en el stack de la ruta.
const SCHEMA_KEY = MCP_EXPOSE_SYMBOL;

function extractSchema(routeStack: Array<{ handle: unknown }>): RouteSchema | undefined {
  let found: RouteSchema | undefined;
  let extra = 0;

  for (const sub of routeStack) {
    const h = sub.handle;
    if (typeof h !== "function") continue;
    const schema = (h as Record<symbol, RouteSchema>)[SCHEMA_KEY];
    if (!schema) continue;
    if (!found) {
      found = schema;
    } else {
      extra++;
    }
  }

  if (extra > 0) {
    warn("multiple-mcpExpose", { count: extra + 1, hint: "se usa el primero" });
  }
  return found;
}
```

**Política HEAD**: Express (4 y 5) **no** auto-genera HEAD para rutas GET (Fastify sí, por eso filtra HEAD en `adaptRouteOptions.ts:8-10`). El adaptador Express incluye HEAD si el usuario lo registra explícitamente. Filtra solo `_all`.

**Deduplicación**: el walker marca `seen` por `METHOD url` y emite warning `duplicate`. `ToolRegistry` en core mantiene su sufijo `_2/_3` solo para colisiones de **nombre tool** (distintas URLs que producen el mismo snake_case — safety net, no el mecanismo primario de dedup).

### 3.5. `autoExpose` factory

```ts
// packages/express/src/autoExpose.ts
import type { Express } from "express";
import type { MCPTool } from "@mcp-auto-expose/core";
import { ToolRegistry, resolveTool } from "@mcp-auto-expose/core";
import { walkRoutes } from "./walkRoutes.js";

export interface AutoExposeOptions {
  strictSchema?: boolean; // default: true (ver §3.1)
  eager?: boolean; // default: false
  basePath?: string;
}

export interface AutoExposeHandle {
  tools(): MCPTool[];
  refresh(): MCPTool[];
}

export function autoExpose(app: Express, options: AutoExposeOptions = {}): AutoExposeHandle {
  const opts: AutoExposeOptions = { strictSchema: true, eager: false, ...options };

  let cache: MCPTool[] | undefined;

  function buildCatalog(): MCPTool[] {
    const registry = new ToolRegistry();
    const descriptors = walkRoutes(app, opts);
    for (const descriptor of descriptors) {
      registry.register(resolveTool(descriptor));
    }
    return registry.list();
  }

  if (opts.eager) {
    cache = buildCatalog();
  }

  return {
    tools(): MCPTool[] {
      if (!cache) cache = buildCatalog();
      return cache;
    },
    refresh(): MCPTool[] {
      cache = buildCatalog();
      return cache;
    },
  };
}
```

**Timing y memoización:**

- `eager: false` (default): walk perezoso en primera llamada a `tools()`, memoizado. No hay `app.ready()` en Express; el marcador natural es el usuario invocando `tools()` justo antes de `startStdio`.
- `eager: true`: walk en `autoExpose()` para detectar problemas de configuración en bootstrap.
- `refresh()`: para tests y escenarios hot-reload donde se añaden rutas después de la primera llamada.

### 3.6. Helper de observabilidad — `warn.ts`

```ts
// packages/express/src/warn.ts
const PREFIX = "[mcp-auto-expose:express]";

export function warn(code: string, ctx: Record<string, unknown>): void {
  const line = `${PREFIX} ${code} ${JSON.stringify(ctx)}\n`;
  process.stderr.write(line);
}
```

**Catálogo de warnings:**

| Código                   | Trigger                                               | Contexto emitido          |
| ------------------------ | ----------------------------------------------------- | ------------------------- |
| `missing-schema-strict`  | `strictSchema:true` y ruta sin `mcpExpose` tagged     | `{ verb, url }`           |
| `regex-parse-failed`     | Express 4: regex de mount no matchea patrón canónico  | `{ source, parentMount }` |
| `unknown-method`         | Verbo fuera del union `HTTPMethod` (e.g., `PROPFIND`) | `{ verb, url }`           |
| `multiple-mcpExpose`     | Más de un middleware tagged en la misma ruta          | `{ count, hint }`         |
| `duplicate`              | Mismo `METHOD url` producido dos veces en el walk     | `{ verb, url }`           |
| `malformed-router-layer` | `layer.name === "router"` sin `handle.stack`          | `{ mountPath }`           |
| `empty-router`           | Stack raíz vacío (app sin rutas)                      | `{}`                      |
| `zod-convert-failed`     | `zodToJsonSchema` lanza excepción                     | `{ message }`             |
| `schema-has-ref`         | Output de `zodToJsonSchema` contiene `$ref`           | `{ hint }`                |

Todos los warnings tienen el prefijo único `[mcp-auto-expose:express]` para grep rápido en producción.

### 3.7. Matriz de compatibilidad Express 4 vs 5

| Feature                  | Express 4                                  | Express 5                             | Estrategia del adaptador                               |
| ------------------------ | ------------------------------------------ | ------------------------------------- | ------------------------------------------------------ |
| Router access            | `app._router` (undefined hasta primer use) | `app.router` getter lazy público      | `app.router` → `lazyrouter?.()` → `app._router` → `[]` |
| Lazy router init         | `app.lazyrouter()` (semi-público)          | No necesario (`app.router` lo activa) | Llamar `lazyrouter` solo si `app.router` ausente       |
| Mount path en sub-router | solo `layer.regexp`                        | `layer.path` poblado                  | Preferir `layer.path`; fallback regex-parsing canónico |
| HEAD auto-generación     | No                                         | No                                    | Emitir HEAD solo si registrado explícitamente          |
| Wildcard                 | `'/users/*'` (sin nombre)                  | `'/users/*splat'` (nombre requerido)  | Passthrough verbatim                                   |
| Optional segments        | `:id?`                                     | `'{/:id}'` brace syntax               | Passthrough verbatim                                   |
| `app.all(...)`           | `methods._all === true` + verbos           | Igual                                 | Filtrar `_all` en `methodsOf`                          |
| Array de paths           | `app.get(['/a', '/b'], ...)`               | Igual                                 | `Array.isArray(layer.route.path)`                      |
| Schema nativo            | Ninguno                                    | Ninguno                               | `mcpExpose` inyectado por el usuario                   |

`peerDependencies: { "express": "^4 || ^5" }`. El suite de tests valida con Express 5 en devDependencies. Los fallback paths de Express 4 se verifican con stacks mockeados (ver §6, Tarea 4).

## 4. Estructura de archivos

```
packages/express/
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── README.md
└── src/
    ├── index.ts              # barrel: autoExpose, mcpExpose, types, MCP_EXPOSE_SYMBOL
    ├── autoExpose.ts         # factory + AutoExposeHandle (lazy + memoized + refresh)
    ├── autoExpose.test.ts    # integración con Express real (v5)
    ├── mcpExpose.ts          # mcpExpose, MCP_EXPOSE_SYMBOL, specToRouteSchema
    ├── mcpExpose.test.ts
    ├── walkRoutes.ts         # walker recursivo + helpers internos
    ├── walkRoutes.test.ts    # tests unitarios con stacks mockeados
    ├── zodConvert.ts         # convertCached + WeakMap cache
    ├── zodConvert.test.ts
    └── warn.ts               # helper único de stderr logging

apps/dev-sandbox/
└── src/
    └── express-main.ts       # NUEVO — smoke Express (no toca main.ts de Fastify)
```

## 5. `packages/express/package.json`

```json
{
  "name": "@mcp-auto-expose/express",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -b",
    "check-types": "tsc --noEmit",
    "lint": "eslint . --max-warnings 0",
    "test": "node --import tsx --test src/*.test.ts"
  },
  "peerDependencies": {
    "express": "^4 || ^5",
    "zod": "^3 || ^4"
  },
  "dependencies": {
    "@mcp-auto-expose/core": "workspace:*",
    "zod-to-json-schema": "^3.25.2"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "@types/express": "^5.0.0",
    "@types/node": "^22.15.3",
    "eslint": "^9.39.1",
    "express": "^5.0.0",
    "tsx": "^4.19.2",
    "typescript": "5.9.2",
    "zod": "^4.0.0"
  }
}
```

**Nota sobre el script `test`**: usa `src/*.test.ts` (glob plano, maxdepth 1) en lugar de la substitución de comando de `packages/fastify`, para mayor portabilidad. Ajustar si se detecta incompatibilidad con la versión de Node en CI.

## 6. Plan de tareas (TDD obligatorio: rojo → verde → commit)

> Cada tarea sigue: tests rojos → implementación → tests verdes → commit. Logs siempre a `stderr`.

### Tarea 1 — Andamiar `packages/express`

- 1.1. Crear `package.json`, `tsconfig.json`, `eslint.config.mjs`, `src/index.ts` vacío.
  - `tsconfig.json`: extender `@repo/typescript-config/base.json`, `outDir: "dist"`, `rootDir: "src"`.
  - `eslint.config.mjs`: `import { config } from "@repo/eslint-config/base"; export default config;`
- 1.2. `pnpm install` → resuelve `express`, `@types/express`, `zod`, `zod-to-json-schema` como deps directas; actualiza lockfile.
- 1.3. `pnpm --filter @mcp-auto-expose/express check-types` verde.
- 1.4. Commit: `chore(express): scaffold @mcp-auto-expose/express package`.

### Tarea 2 — `zodConvert` + `warn`

- 2.1. Crear `src/warn.ts` (no requiere test unitario — trivial `process.stderr.write`).
- 2.2. Tests rojos (`zodConvert.test.ts`):
  - `z.object({ id: z.string() })` → produce `{ type: "object", properties: { id: { type: "string" } }, required: ["id"] }` (verificar subset de propiedades).
  - `z.string()` → produce `{ type: "string" }`.
  - Misma instancia de `z.object` usada dos veces → segunda llamada retorna el mismo objeto (cache hit) — verificar con `Object.is`.
  - `specToRouteSchema({ query: z.string() })` → `.querystring` poblado, `.body` undefined.
  - `specToRouteSchema({ tags: ["t1"] })` → `.tags` es copia (`!Object.is`).
- 2.3. Implementar `zodConvert.ts` con `convertCached` y `specToRouteSchema`.
- 2.4. Verde + commit: `feat(express): zod-to-json-schema Draft 7 converter with WeakMap cache`.

### Tarea 3 — `mcpExpose` middleware

- 3.1. Tests rojos (`mcpExpose.test.ts`):
  - El valor retornado por `mcpExpose({})` es una función.
  - Llamar al middleware invoca `next()` una vez.
  - `(mcpExpose({}) as any)[MCP_EXPOSE_SYMBOL]` retorna un objeto (no undefined).
  - `mcpExpose({ query: z.string() })[MCP_EXPOSE_SYMBOL].querystring` está poblado.
  - `mcpExpose({ hide: true })[MCP_EXPOSE_SYMBOL].hide === true`.
  - `mcpExpose({ tags: ["t1"] })[MCP_EXPOSE_SYMBOL].tags` es copia defensiva.
  - Compile-only: `app.get(path, mcpExpose({}), handler)` type-checks sin cast.
- 3.2. Implementar `mcpExpose.ts`.
- 3.3. Verde + commit: `feat(express): mcpExpose decorator middleware (pure metadata carrier)`.

### Tarea 4 — `walkRoutes` y helpers

- 4.1. Tests rojos (`walkRoutes.test.ts`) construyendo stacks Express manuales (sin servidor):
  - Ruta terminal simple: `[{ route: { path: "/api/users", methods: { get: true }, stack: [] } }]` → 1 descriptor `GET /api/users`.
  - Sub-router montado (Express 5): layer con `name: "router"`, `path: "/api"`, `handle.stack` con ruta `/users` → descriptor `GET /api/users`.
  - Sub-router montado (Express 4 fallback): layer sin `path`, con `regexp.source` matcheable → mount `/api` recuperado.
  - `methods._all === true` junto con verbos → `_all` filtrado, verbos emitidos.
  - Verbo `PROPFIND` → warning `unknown-method`, descriptor omitido.
  - Mismo `GET /api/users` dos veces → warning `duplicate`, segundo omitido.
  - `extractSchema`: ruta con un middleware tagged → `RouteSchema` retornada.
  - `extractSchema`: ruta con dos middlewares tagged → warning `multiple-mcpExpose`, primero retornado.
  - `extractSchema`: sin middleware tagged → `undefined`.
  - `opts.strictSchema: true` + schema undefined → warning `missing-schema-strict`, descriptor omitido.
  - `opts.strictSchema: false` + schema undefined → descriptor emitido.
  - `hide: true` en RouteSchema → descriptor omitido silenciosamente.
  - Array de paths: `route.path = ["/a", "/b"]` → 2 descriptores.
  - `basePath: "/api"` → stripeado del mountPath inicial.
- 4.2. Implementar `walkRoutes.ts` con todos los helpers internos.
- 4.3. Verde + commit: `feat(express): recursive route walker with Express 4/5 compat`.

### Tarea 5 — `autoExpose` factory (integración con Express real)

- 5.1. Tests rojos (`autoExpose.test.ts`) con Express **real** (v5), sin servidor HTTP:
  - App con 3 rutas CRUD vía Router + `mcpExpose`, `strictSchema:true` → `tools()` retorna exactamente 3 `MCPTool` con names `list_users`, `get_users_by_id`, `create_users`.
  - `get_users_by_id.inputSchema.properties.id.type === "string"`, `required: ["id"]`.
  - `create_users.inputSchema.properties.name` y `.email` presentes, `required: ["name", "email"]`.
  - `tools()` segunda llamada retorna el mismo objeto (memoized, `Object.is` true).
  - `refresh()` retorna nuevo objeto con mismo contenido.
  - `eager: true` → walk ocurre en `autoExpose()` (verificable con spy en `walkRoutes`).
  - `strictSchema: true` + 1 ruta sin `mcpExpose` → esa ruta no aparece en `tools()`.
  - `mcpExpose({ hide: true })` → ruta omitida de `tools()`.
  - `_source.framework === "express"` en cada tool.
- 5.2. Implementar `autoExpose.ts`.
- 5.3. Barrel `src/index.ts` con todos los exports públicos.
- 5.4. `pnpm --filter @mcp-auto-expose/express check-types` verde.
- 5.5. Verde + commit: `feat(express): autoExpose factory with lazy memoized walk`.

### Tarea 6 — Smoke en `apps/dev-sandbox`

- 6.1. Crear `apps/dev-sandbox/src/express-main.ts` (ver snippet en §3.1). Sin ningún `console.log`.
- 6.2. Añadir a `apps/dev-sandbox/package.json`:
  - Script: `"dev:express": "node --import tsx src/express-main.ts"`.
  - Deps: `express: "^5.0.0"`, `zod: "^4.0.0"`, `@mcp-auto-expose/express: "workspace:*"`.
- 6.3. `pnpm install` + `pnpm --filter dev-sandbox check-types` verde.
- 6.4. **Verificación manual** — inicializar y listar tools:
  ```sh
  printf '%s\n%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | pnpm --filter dev-sandbox run dev:express 2>express-sandbox.stderr.log
  ```
  **stdout esperado:** exactamente 2 líneas JSON-RPC — respuesta `initialize` y respuesta `tools/list` con 3 tools (`list_users`, `get_users_by_id`, `create_users`). Sin ninguna otra línea.
  **stderr esperado** (`express-sandbox.stderr.log`): logs de diagnóstico del adaptador. No contamina stdout.
  **Prueba del guard:** añadir `console.log("ruido")` antes de `startStdio` → stdout sigue siendo JSON-RPC puro.
  **Prueba de strictSchema:** comentar `mcpExpose` en una ruta → `tools/list` baja a 2 tools y stderr muestra `missing-schema-strict`.
- 6.5. Commit: `chore(dev-sandbox): add Express smoke entry-point`.

### Tarea 7 — README de `packages/express`

- 7.1. Snippet de uso completo: Express + Router + `mcpExpose` + `autoExpose` + `startStdio`.
- 7.2. Sección **strictSchema default divergente vs Fastify**: justificación de seguridad.
- 7.3. Nota sobre `process.stdout.write` — no usar directamente (reservado para JSON-RPC de stdio).
- 7.4. Tabla de compatibilidad Express 4 vs 5 (resumida, ref §3.7).
- 7.5. Sección edge cases de Zod (`z.discriminatedUnion`, `z.lazy`): qué esperar.
- 7.6. Commit: `docs(express): usage, safety constraints, and Express 4/5 compat notes`.

### Tarea 8 — CI/turbo y lint global

- 8.1. Verificar que `tsc -b` produce `dist/` y que `turbo.json` cubre `dist/**` en `build.outputs` (ya verificado: sí — no requiere cambio).
- 8.2. `pnpm --filter @mcp-auto-expose/express lint` verde (0 warnings).
- 8.3. `pnpm lint` global verde.
- 8.4. `pnpm --filter @mcp-auto-expose/express test` verde.
- 8.5. Commit: `chore(turbo): add @mcp-auto-expose/express to workspace` (si se requieren ajustes; si no, omitir).

## 7. Verificación de aceptación

### 7.1. Automática

```sh
pnpm install
pnpm --filter @mcp-auto-expose/express check-types
pnpm --filter @mcp-auto-expose/express test
pnpm --filter dev-sandbox check-types
pnpm lint
```

Todos verdes, cero warnings de lint.

### 7.2. Manual (smoke stdio + Express)

Ver Tarea 6.4. Criterio de éxito:

- `tools/list` emite 3 tools con nombres y schemas correctos.
- stdout = JSON-RPC puro; stderr = logs del adaptador.
- Quitar un `mcpExpose` → warning en stderr, herramienta desaparece del catálogo.
- `console.log("ruido")` → redirigido a stderr por el guard de stdio.

## 8. Notas y decisiones explícitas

- **`strictSchema: true` por defecto**: diverge intencionalmente de Fastify (`false`). Justificación: Express es prevalente en apps legacy con endpoints internos/admin; opt-in explícito previene exposición accidental al LLM. Documentado en README.
- **`mcpExpose` puro (no-op en runtime)**: la validación HTTP no es responsabilidad de este paquete en el MVP. Extensión futura retrocompatible: `{ validate: true }`.
- **First-wins en múltiples `mcpExpose`**: matchea semántica Express de "primero gana". Warning a stderr para localizar el bug.
- **Sin cambios en `@mcp-auto-expose/core`**: `RouteDescriptor.framework: "express"` ya soportado; `RouteSchema` ya cubre todos los campos; `resolveTool` y `ToolRegistry` reutilizados sin modificación.
- **UTF-8 sin BOM** en todos los archivos.
- **TypeScript strict**: `noUncheckedIndexedAccess` heredado de `@repo/typescript-config/base.json`; no se relaja.
- **Logs**: todo diagnóstico via `warn(code, ctx)` con prefijo `[mcp-auto-expose:express]`; escriben a `process.stderr`.
- **`zod-to-json-schema`**: `$refStrategy: "none"` + `target: "jsonSchema7"` + sin `name` — justificaciones en §3.3.
- **Timing**: `autoExpose(app)` después de registrar todas las rutas, antes de `startStdio`. Walk lazy (default) o eager según `options.eager`.

---

**Punto de control:** Especificación de la Fase 3 lista. Por favor, revisa el archivo de diseño para Express y dame tu aprobación para comenzar la implementación.
