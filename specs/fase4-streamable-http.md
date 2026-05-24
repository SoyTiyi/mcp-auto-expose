# Fase 4 — Transporte Streamable HTTP y Autenticación

> **Estado:** Aprobado — implementación en curso.
> **Metodología:** Spec-Driven Development (SDD).
> **Anclaje al documento principal:** `docs/principal-document.txt` L77–L118 (Streamable HTTP, SEP-2243, defensas DNS rebinding) y L192–L202 (Fase 5 del roadmap del producto).
> **Predecesoras aprobadas:** Fase 1 (Fastify), Fase 2 (stdio), Fase 3 (Express).

---

## Context

La Fase 3 entregó adapters Express y Fastify que extraen `MCPTool[]` en memoria sin montar ningún endpoint. La única salida MCP existente hoy va por stdio (`@mcp-auto-expose/stdio`), apta para hosts locales (Claude Desktop, Cursor) pero incapaz de soportar despliegues remotos multi-cliente.

La Fase 4 cierra el roadmap del documento principal habilitando **transporte Streamable HTTP** sobre `StreamableHTTPServerTransport` del SDK `@modelcontextprotocol/sdk` 1.29.0, en cumplimiento literal de:

- **Endpoint único HTTP** que sirva POST (JSON-RPC) y GET (SSE) sobre el mismo path (`docs/principal-document.txt:81-83`).
- **SEP-2243**: cabeceras `Mcp-Method` y `Mcp-Name` obligatorias y coherentes con el body JSON-RPC; rechazo incondicional si discrepan (`:88-91, :202`).
- **Defensas contra DNS rebinding**: validación de `Origin` con whitelist y `403` ante discrepancia; bind a `127.0.0.1` (responsabilidad documentada del usuario) (`:116-117`).
- **Autenticación delegada al andamiaje moderno**: Bearer/API keys/OAuth 2.0 (`:118`). Decisión arquitectónica nuestra: el adapter NO valida tokens; delega a middlewares nativos del framework anfitrión (Passport, Fastify auth plugins, etc.).

Resultado esperado: el usuario puede pasar de stdio a Streamable HTTP cambiando un único paquete de salida, conservando el mismo array `MCPTool[]` y el mismo callback `onToolCall`.

---

## 1. Objetivo

Construir un paquete framework-agnóstico `@mcp-auto-expose/http` que monta un endpoint MCP Streamable HTTP único en una aplicación Node anfitriona, más dos sub-binders idiomáticos (`/express`, `/fastify`). El paquete:

1. Reutiliza `StreamableHTTPServerTransport` del SDK 1.29.0.
2. Valida cabeceras SEP-2243 antes de ceder el control al SDK.
3. Aplica whitelist de `Origin` configurable.
4. Soporta la extensión **`x-mcp-header`** definida en SEP-2243 Final para parámetros transportados como `Mcp-Param-{Name}`.
5. **No** implementa autenticación; documenta el patrón de delegación.
6. Mantiene paridad de catálogo con stdio (mismos `MCPTool`, mismo `onToolCall`).

---

## 2. Arquitectura

### 2.1 Paquete nuevo

`packages/http` — `@mcp-auto-expose/http`.

Exporta tres entradas:

| Subpath | Propósito |
|---|---|
| `@mcp-auto-expose/http` | Factory framework-agnóstica `createMcpHttp` + tipos compartidos. |
| `@mcp-auto-expose/http/express` | Binder `mountMcpExpress` (devuelve `RequestHandler` + `Router`). |
| `@mcp-auto-expose/http/fastify` | Binder `mcpFastifyPlugin` (FastifyPluginAsync). |

### 2.2 Cambios en paquetes existentes

- `packages/core`: sin cambios estructurales en `MCPTool`. La invocación sigue siendo "out-of-band" via callback `onToolCall` (mismo contrato que stdio).
- `packages/express`: añade helper `mcpHeader(zodSchema)` y modifica el converter `zodConvert.ts` para preservar la anotación `"x-mcp-header": true` en el JSON Schema producido.
- `packages/fastify`: añade helper `mcpHeader(zodSchema)` simétrico y replica el preservado de la anotación en `adaptRouteOptions.ts`.
- `packages/stdio`: sin cambios. Sigue dispatching por callback. Su contrato `(tool, args) => result` es subset del HTTP `(tool, args, ctx) => result` — un mismo callback funciona en ambos transports.

### 2.3 Decisiones arquitectónicas confirmadas con el usuario

| Decisión | Resultado |
|---|---|
| **Endpoint** | Path único (default `/mcp`, configurable) sirviendo POST + GET + DELETE. Alinea con `docs/principal-document.txt:81` ("un único punto final"). |
| **Ubicación** | Paquete nuevo `@mcp-auto-expose/http` con sub-binders. Preserva el invariante de Fase 3. |
| **Declaración `x-mcp-header`** | Helper Zod `mcpHeader(z.string())` que stampa la anotación en el JSON Schema. |

### 2.4 Decisiones técnicas adicionales

- **Dispatch**: callback explícito `onToolCall(tool, args, ctx)`. La re-invocación virtual de rutas Express/Fastify queda fuera de alcance (futura Fase 4.1 opcional).
- **Sesiones**: stateless por default (`sessionIdGenerator: undefined`), stateful opt-in vía `options.session: "stateful"`.
- **Auth**: delegada al framework anfitrión. El adapter propaga `req.auth` (si existe) a `ctx.auth`.
- **Defensa Origin**: middleware integrado. Default `allowedOrigins: []` permite peticiones **sin** Origin (clientes CLI, server-to-server) con warning a stderr; rechaza con `403` cualquier Origin presente que no matchee la whitelist.
- **Localhost bind**: no enforced por el adapter (es responsabilidad de `app.listen()`). El adapter emite warning a stderr si detecta `HOST=0.0.0.0` o `BIND_ADDRESS=0.0.0.0` en env. Documentado en README.

---

## 3. Diseño técnico detallado

### 3.1 API pública — `packages/http/src/index.ts`

```ts
import type { Server } from "@modelcontextprotocol/sdk/server";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { MCPTool } from "@mcp-auto-expose/core";

export interface McpHttpContext {
  /** Cabeceras crudas (lowercase keys). */
  headers: Record<string, string | string[] | undefined>;
  /** AuthInfo propagado desde req.auth por middlewares previos. */
  auth?: unknown;
  /** Subset SEP-2243 proyectado. */
  mcp: { method: string; name: string };
  /** Args extraídos de Mcp-Param-* (ver §3.4). */
  headerParams: Record<string, string>;
}

export type OnToolCallHttp = (
  tool: MCPTool,
  args: unknown,
  ctx: McpHttpContext,
) => Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }>;

export interface McpHttpOptions {
  /** Default "/mcp". */
  path?: string;
  /** Whitelist Origin. Default []: requiere Origin ausente o opt-in explícito. */
  allowedOrigins?: string[];
  /** Default "stateless". */
  session?: "stateful" | "stateless";
  /** Default randomUUID si session=stateful. */
  sessionIdGenerator?: () => string;
  /** Default false: SDK responde con SSE. true ⇒ JSON puro. */
  enableJsonResponse?: boolean;
  /** Default true: warning a stderr si bind=0.0.0.0. */
  warnOnNonLocalhost?: boolean;
  tools: MCPTool[];
  name: string;
  version: string;
  onToolCall: OnToolCallHttp;
  /** Inyección controlada para tests. */
  _deps?: { server?: Server; transport?: StreamableHTTPServerTransport };
}

export interface McpHttpHandle {
  handleNodeRequest(
    req: import("node:http").IncomingMessage & { auth?: unknown; body?: unknown },
    res: import("node:http").ServerResponse,
  ): Promise<void>;
  close(): Promise<void>;
}

export function createMcpHttp(options: McpHttpOptions): McpHttpHandle;
```

### 3.2 Binder Express — `packages/http/src/express.ts`

```ts
import type { RequestHandler, Router } from "express";
import type { McpHttpOptions } from "./index.js";

export interface MountMcpExpressResult {
  middleware: RequestHandler;          // app.all('/mcp', mw)
  router: Router;                       // app.use(router); pre-monta path
  close(): Promise<void>;
}

export function mountMcpExpress(opts: McpHttpOptions): MountMcpExpressResult;
```

### 3.3 Binder Fastify — `packages/http/src/fastify.ts`

```ts
import type { FastifyPluginAsync, FastifyPluginOptions } from "fastify";
import type { McpHttpOptions } from "./index.js";

export type McpFastifyPluginOptions = McpHttpOptions & FastifyPluginOptions;
export const mcpFastifyPlugin: FastifyPluginAsync<McpFastifyPluginOptions>;
```

### 3.4 Pipeline `x-mcp-header` (definido en SEP-2243 Final)

#### 3.4.1 Declaración por el usuario

```ts
import { z } from "zod";
import { mcpHeader, mcpExpose } from "@mcp-auto-expose/express";

const schema = z.object({
  tenant_id: mcpHeader(z.string().describe("Tenant id from auth context")),
  invoice_id: z.string(),
});

router.post("/invoices", mcpExpose({
  name: "create_invoice",
  description: "Create an invoice for the tenant",
  inputSchema: schema,
}), handler);
```

#### 3.4.2 Conversión Zod → JSON Schema

`mcpHeader<T extends ZodTypeAny>(zod: T): T` stampa un marker `__mcpHeader = true` sobre el schema Zod (vía `WeakSet` interno para no mutar el objeto). El converter en `packages/express/src/zodConvert.ts` detecta el marker y produce:

```json
{
  "type": "object",
  "properties": {
    "tenant_id": { "type": "string", "description": "Tenant id from auth context", "x-mcp-header": true },
    "invoice_id": { "type": "string" }
  },
  "required": ["tenant_id", "invoice_id"]
}
```

La propiedad **permanece visible al LLM** (puede pasarla como argumento normal). La anotación informa al adapter HTTP qué params puede recoger también de cabeceras.

#### 3.4.3 Naming verbatim del header

El valor del campo `x-mcp-header` se usa **verbatim** como segmento del header HTTP — sin kebabize ni transformación adicional.

- `"x-mcp-header": "TenantId"` ⇄ `Mcp-Param-TenantId`
- `"x-mcp-header": "Region"` ⇄ `Mcp-Param-Region`

Constraints del valor (SEP-2243 §"Custom Headers from Tool Parameters"):

- No vacío.
- Solo ASCII (excluyendo espacio y `:`).
- Case-insensitivamente único entre todos los `x-mcp-header` del mismo `inputSchema`.
- Solo aplicable a propiedades de tipo primitivo (`string`, `number`, `boolean`).

#### 3.4.4 Política de merge body ↔ header

| Caso | body.args | header | args resultante | Side effect |
|---|---|---|---|---|
| Solo body | `{tenant_id:"a"}` | ausente | `{tenant_id:"a"}` | — |
| Solo header | `{}` | `"a"` | `{tenant_id:"a"}` | `ctx.headerParams.tenant_id="a"` |
| Coinciden | `{tenant_id:"a"}` | `"a"` | `{tenant_id:"a"}` | — |
| Discrepan | `{tenant_id:"a"}` | `"b"` | `{tenant_id:"b"}` | warn `header-body-mismatch` a stderr |

"Header gana" porque la spec posiciona las cabeceras como capa de routing del edge; un proxy/gateway puede haberlas inyectado autoritativamente. Documentado en README.

#### 3.4.5 Encoding sentinel Base64 para valores no representables como ASCII plano

El cliente codifica el valor del parámetro como Base64 estándar (RFC 4648 §4, con padding `=`) envuelto en el sentinel `=?base64?<valor>?=` cuando el string serializado:

- empieza o termina con espacio (0x20) o tab (0x09),
- contiene cualquier carácter fuera de 0x20-0x7E (no-ASCII), o
- contiene control chars (0x00-0x1F o 0x7F).

El servidor decodifica el sentinel antes de comparar contra el body. Falla de decode ⇒ error `-32001` (`HeaderMismatch`).

### 3.5 Validación SEP-2243 — `packages/http/src/sep2243.ts`

```ts
export interface Sep2243Outcome {
  ok: boolean;
  reason?: "missing-header" | "method-mismatch" | "name-mismatch" | "malformed-body";
  mcp?: { method: string; name: string };
}

export function validateSep2243(
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
): Sep2243Outcome;
```

Reglas (derivadas de `docs/principal-document.txt:88-91` y `:202`):

- POST con body JSON-RPC requiere `Mcp-Method` presente. Ausencia ⇒ `missing-header` ⇒ `400`.
- Si `method === "tools/call"`, también requiere `Mcp-Name` y matching con `body.params.name`.
- `body.method !== headers["mcp-method"]` ⇒ `method-mismatch` ⇒ `400`.
- GET (apertura SSE) no requiere `Mcp-Name`.
- `initialize`, `tools/list`, `ping`: `Mcp-Name` opcional (header puede estar vacío o ausente; si presente, sin validación de coherencia porque no hay name target).
- DELETE (cierre de sesión stateful): cabeceras opcionales.

**Orden de ejecución:** ANTES del SDK transport. El SDK 1.29 no valida coherencia header↔body.

### 3.6 Defensa Origin — `packages/http/src/origin.ts`

```ts
export function checkOrigin(
  originHeader: string | undefined,
  allowedOrigins: string[],
): { ok: true } | { ok: false; status: 403; reason: string };
```

- `originHeader` ausente ⇒ `ok: true` + warning una vez por minuto si `allowedOrigins.length === 0`.
- `originHeader` presente:
  - Si `allowedOrigins.length === 0` ⇒ `403` (la spec exige verificar; sin whitelist no podemos aprobar).
  - Si matching exacto case-insensitive ⇒ `ok: true`.
  - Si no matchea ⇒ `403` con `{"error":"forbidden"}` (sin información adicional al atacante).

### 3.7 Dispatch bridge — `packages/http/src/createMcpHttp.ts`

Pasos del factory en orden:

1. Validar opciones (`path` empieza por `/`, `allowedOrigins` es array, `name`/`version` no vacíos).
2. `localhostWarn(warnOnNonLocalhost)` lee env y emite warning si procede.
3. Crear `AsyncLocalStorage<McpHttpContext>` (`httpContextStorage`).
4. Instanciar `new Server({ name, version }, { capabilities: { tools: {} } })`.
5. Llamar `registerTools({ server, tools, onToolCall: bridge })` donde `bridge(tool, args)` lee `httpContextStorage.getStore()`, mergea `headerParams` en `args` (política §3.4.4) y delega a `userOnToolCall(tool, enrichedArgs, ctx)`.
6. Instanciar `new StreamableHTTPServerTransport({ sessionIdGenerator: session === "stateful" ? (sessionIdGenerator ?? randomUUID) : undefined, enableJsonResponse })`.
7. `await server.connect(transport)`.
8. Retornar `{ handleNodeRequest, close }`.

`handleNodeRequest(req, res)`:

1. `originGuard` → si falla, `res.writeHead(403).end(...)` y return.
2. Parsear body (los binders Express/Fastify aseguran que `req.body` ya está parseado JSON).
3. `validateSep2243(req.headers, req.body)` → si falla, `400` con `{ "error": "<reason>" }`.
4. Construir `ctx`: headers normalizados (lowercase), `auth: req.auth`, `mcp: { method, name }`, `headerParams` extraídos por `parseHeaderParams(req.headers, toolByName(headers["mcp-name"]))`.
5. `httpContextStorage.run(ctx, () => transport.handleRequest(req, res, req.body))`.

### 3.8 Matriz de paridad transports

| Capacidad | stdio | Streamable HTTP |
|---|---|---|
| Catálogo tools (`MCPTool[]`) | ✅ | ✅ idéntico |
| `onToolCall(tool, args)` | ✅ | ✅ + 3er arg `ctx` (opcional, retrocompatible) |
| `Mcp-Param-*` headers | N/A | ✅ |
| Auth context (`ctx.auth`) | N/A | ✅ delegado al framework |
| Sesiones | N/A | ✅ stateless default, stateful opt-in |

---

## 4. Estructura de archivos

```
packages/http/
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── README.md
└── src/
    ├── index.ts                  # barrel + createMcpHttp
    ├── createMcpHttp.ts          # factory framework-agnóstica
    ├── createMcpHttp.test.ts
    ├── sep2243.ts                # validateSep2243 (puro)
    ├── sep2243.test.ts
    ├── origin.ts                 # checkOrigin (puro)
    ├── origin.test.ts
    ├── headerParams.ts           # kebabize / parseHeaderParams / mergeArgs
    ├── headerParams.test.ts
    ├── localhostWarn.ts          # detección 0.0.0.0
    ├── express.ts                # mountMcpExpress
    ├── express.test.ts           # supertest + express real
    ├── fastify.ts                # mcpFastifyPlugin
    ├── fastify.test.ts           # fastify.inject()
    └── warn.ts                   # logger stderr prefijo [mcp-auto-expose:http]

packages/express/src/
├── mcpHeader.ts                  # NUEVO: helper mcpHeader() (stamp marker)
└── zodConvert.ts                 # MOD: preservar x-mcp-header en JSON Schema

packages/fastify/src/
├── mcpHeader.ts                  # NUEVO: simétrico a express
└── adaptRouteOptions.ts          # MOD: preservar x-mcp-header

apps/dev-sandbox/src/
├── http-express-main.ts          # NUEVO: smoke Streamable HTTP + Express
├── http-fastify-main.ts          # NUEVO: smoke Streamable HTTP + Fastify
└── http-client-smoke.ts          # NUEVO: cliente MCP del SDK contra cualquiera
```

---

## 5. `packages/http/package.json`

```jsonc
{
  "name": "@mcp-auto-expose/http",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./express": { "import": "./dist/express.js", "types": "./dist/express.d.ts" },
    "./fastify": { "import": "./dist/fastify.js", "types": "./dist/fastify.d.ts" }
  },
  "scripts": {
    "build": "tsc -b",
    "check-types": "tsc -b --noEmit",
    "test": "vitest run",
    "lint": "eslint . --max-warnings 0"
  },
  "dependencies": {
    "@mcp-auto-expose/core": "workspace:*"
  },
  "peerDependencies": {
    "@modelcontextprotocol/sdk": "~1.29.0",
    "express": "^4.0.0 || ^5.0.0",
    "fastify": "^5.0.0"
  },
  "peerDependenciesMeta": {
    "express": { "optional": true },
    "fastify": { "optional": true }
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "*",
    "express": "^5.1.0",
    "fastify": "^5.0.0",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

---

## 6. Plan de tareas (TDD: rojo → verde → commit)

> Logs a `stderr` siempre con prefijo `[mcp-auto-expose:http]`. UTF-8 sin BOM. Cero `console.log`.

### Tarea 1 — Andamiar `packages/http`
- 1.1. `package.json`, `tsconfig.json`, `eslint.config.mjs`, barrel vacío.
- 1.2. Añadir al `pnpm-workspace.yaml` si hace falta y refrescar `pnpm install`.
- 1.3. `pnpm --filter @mcp-auto-expose/http check-types` verde.
- 1.4. Commit: `chore(http): scaffold @mcp-auto-expose/http`.

### Tarea 2 — `origin.ts`
- 2.1. Tests rojos (matriz: ausente, presente match, presente no-match, whitelist vacía).
- 2.2. Implementación.
- 2.3. Commit: `feat(http): origin whitelist guard`.

### Tarea 3 — `sep2243.ts`
- 3.1. Tests rojos: missing header, mismatch method, mismatch name (en tools/call), GET sin Mcp-Name aceptado, `tools/list` sin Mcp-Name aceptado, malformed body, `initialize`.
- 3.2. Implementación.
- 3.3. Commit: `feat(http): SEP-2243 header coherence validator`.

### Tarea 4 — `headerParams.ts`
- 4.1. Tests rojos:
  - `kebabize("tenant_id") === "Tenant-Id"`.
  - `kebabize("invoice_external_ref") === "Invoice-External-Ref"`.
  - `parseHeaderParams` extrae solo props con `x-mcp-header: true` del schema.
  - `mergeArgs` aplica la política §3.4.4 (header gana en discrepancia + warn).
- 4.2. Implementación.
- 4.3. Commit: `feat(http): Mcp-Param-* header param pipeline`.

### Tarea 5 — `mcpHeader()` en `packages/express` y `packages/fastify`
- 5.1. Tests rojos en `packages/express/src/zodConvert.test.ts`:
  - `mcpHeader(z.string())` produce JSON-Schema con `"x-mcp-header": true`.
  - Cuando se combina con `.describe(...)` ambos coexisten.
- 5.2. Mismo conjunto de tests para `packages/fastify`.
- 5.3. Implementar `mcpHeader.ts` (cada paquete con su propio WeakSet, ambos generan `x-mcp-header: true`).
- 5.4. Modificar converters para detectar marker y stampar anotación.
- 5.5. Commit: `feat(zod): mcpHeader() annotation for header-borne params`.

### Tarea 6 — `createMcpHttp.ts`
- 6.1. Tests rojos (con `_deps` para inyectar transport in-memory):
  - `tools/list` round-trip retorna los tools provistos.
  - `tools/call` invoca `onToolCall` con args correctos.
  - `ctx.mcp.method === "tools/call"`, `ctx.mcp.name === <tool>` al disparar el callback.
  - `ctx.headerParams.tenant_id` poblado cuando viaja `Mcp-Param-Tenant-Id`.
  - `ctx.auth` propaga `req.auth`.
  - `close()` cierra transport y server.
- 6.2. Implementación con AsyncLocalStorage.
- 6.3. Commit: `feat(http): createMcpHttp factory with Streamable transport`.

### Tarea 7 — `mountMcpExpress`
- 7.1. Tests rojos (supertest + Express real):
  - `POST /mcp` con body `initialize` retorna 200 + `protocolVersion`.
  - `POST /mcp` con `Mcp-Method: tools/list` retorna catálogo.
  - `POST /mcp` con discrepancia header/body → 400.
  - `POST /mcp` con `Origin` no en whitelist → 403.
  - `GET /mcp` con `Accept: text/event-stream` abre SSE.
  - Middleware previo que setea `req.auth = {sub:"u1"}` propaga a `ctx.auth`.
  - `Mcp-Param-Tenant-Id` se inyecta en args del handler.
- 7.2. Implementación: Router con `.post`, `.get`, `.delete` sobre `path`.
- 7.3. Commit: `feat(http): Express binder for Streamable HTTP`.

### Tarea 8 — `mcpFastifyPlugin`
- 8.1. Tests rojos (fastify.inject):
  - Mismas casuísticas que Tarea 7.
  - `addContentTypeParser` propio sobre el path `/mcp` para no chocar con el parser por defecto de Fastify.
  - `disableRequestLogging` opcional respetado.
- 8.2. Implementación.
- 8.3. Commit: `feat(http): Fastify binder for Streamable HTTP`.

### Tarea 9 — Smoke Express en `apps/dev-sandbox`
- 9.1. `http-express-main.ts`: Express + Router + `mcpExpose` (4 tools, incluyendo uno con `mcpHeader` para `tenant_id`).
- 9.2. `autoExpose` extrae `tools`; `mountMcpExpress({tools, onToolCall, allowedOrigins:["http://localhost:5173"]})`.
- 9.3. `app.listen(3000, "127.0.0.1")`.
- 9.4. Commit: `chore(dev-sandbox): HTTP Express smoke entry-point`.

### Tarea 10 — Smoke Fastify
- 10.1. `http-fastify-main.ts` análogo.
- 10.2. Commit: `chore(dev-sandbox): HTTP Fastify smoke entry-point`.

### Tarea 11 — Cliente MCP SDK end-to-end
- 11.1. `http-client-smoke.ts`: `StreamableHTTPClientTransport` apunta a `127.0.0.1:3000/mcp`, ejecuta `listTools()` + `callTool()`.
- 11.2. Verifica paridad de catálogo contra stdio.
- 11.3. Commit: `chore(dev-sandbox): MCP SDK client smoke for HTTP transport`.

### Tarea 12 — README de `packages/http`
- 12.1. Patrón de uso Express con middleware de auth previo.
- 12.2. Patrón Fastify equivalente con `preHandler`.
- 12.3. Sección **Seguridad**: Origin, bind a `127.0.0.1`, auth delegada.
- 12.4. Sección **SEP-2243**: ejemplos curl con cabeceras correctas e incorrectas.
- 12.5. Sección **Extensión `x-mcp-header`** declarada como extensión propia del proyecto (no SEP MCP).
- 12.6. Commit: `docs(http): usage, security, SEP-2243 reference`.

### Tarea 13 — CI / lint global
- 13.1. `pnpm lint`, `pnpm test`, `pnpm build` verdes en raíz.
- 13.2. Ajustar `turbo.json` si se requiere declarar nuevas envs/inputs.
- 13.3. Commit: `chore(ci): wire @mcp-auto-expose/http into turbo pipeline`.

---

## 7. Verificación de aceptación

### 7.1 Automática

```sh
pnpm install
pnpm --filter @mcp-auto-expose/http check-types
pnpm --filter @mcp-auto-expose/http test
pnpm --filter @mcp-auto-expose/express test    # incluye nuevos tests de mcpHeader
pnpm --filter @mcp-auto-expose/fastify test    # idem
pnpm --filter dev-sandbox check-types
pnpm lint
pnpm build
```

Criterio: todo verde, cero warnings ESLint.

### 7.2 Manual con curl (sandbox Express corriendo en 127.0.0.1:3000)

```sh
# 1. initialize
curl -sN -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Method: initialize" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'

# 2. tools/list
curl -sN -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Method: tools/list" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 3. tools/call con Mcp-Param-*
curl -sN -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Method: tools/call" -H "Mcp-Name: create_invoice" -H "Mcp-Param-Tenant-Id: t1" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"create_invoice","arguments":{"invoice_id":"inv-001"}}}'

# 4. Discrepancia header/body → 400
curl -sN -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json" \
  -H "Mcp-Method: tools/list" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call"}'

# 5. Origin rechazado → 403
curl -sN -X POST http://127.0.0.1:3000/mcp \
  -H "Origin: https://evil.example" -H "Content-Type: application/json" \
  -H "Mcp-Method: tools/list" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/list"}'

# 6. SSE GET
curl -sN -X GET http://127.0.0.1:3000/mcp -H "Accept: text/event-stream"
```

### 7.3 Manual con cliente MCP del SDK

`pnpm --filter dev-sandbox tsx src/http-client-smoke.ts` ⇒ imprime catálogo y resultado de `callTool` exitoso. El catálogo debe ser **idéntico** al obtenido por stdio en `apps/dev-sandbox/src/main.ts`.

### 7.4 Smoke Fastify

`pnpm --filter dev-sandbox tsx src/http-fastify-main.ts` ⇒ exhibe paridad cross-framework.

---

## 8. Notas y decisiones explícitas

1. **Extensión `x-mcp-header`** está definida en SEP-2243 Final (https://modelcontextprotocol.io/seps/2243-http-standardization) — no es una extensión propia del proyecto. El README debe declararla como parte del estándar MCP.

2. **Auth delegada al framework** NO está mandada explícitamente por `docs/principal-document.txt`. El doc autoriza Bearer/OAuth pero no obliga a delegar al framework. La decisión se justifica por: (a) el adapter no debe duplicar ecosistemas maduros (Passport, JWT, Fastify auth); (b) mantener el adapter framework-agnóstico en la capa transport; (c) el SDK 1.29 ya soporta `AuthInfo` propagado vía `req.auth`.

3. **Bind a `127.0.0.1`** no es enforced por el adapter — es `app.listen()`. Warning a stderr + documentación.

4. **Stateless por default** alinea con `docs/principal-document.txt:92-97` (SEP-2549). Stateful queda opt-in.

5. **Re-invocación virtual de rutas Express/Fastify** queda fuera de alcance — Fase 4.1 opcional futura.

6. **Versión SDK pin**: `~1.29.0` en `peerDependencies` durante MVP.

7. **Tests SSE**: usar `testTimeout: 5000` en Vitest para evitar cuelgues.

8. **Encoding**: todos los archivos UTF-8 sin BOM.
