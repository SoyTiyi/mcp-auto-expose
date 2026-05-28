# mcp-auto-expose

Expone automáticamente los endpoints de una API REST (Fastify / Express) como herramientas MCP.
Cero configuración manual: la librería inspecciona el enrutador del framework y registra las tools en un servidor MCP, listo para ser consumido por agentes LLM.

Protocol: **MCP 2025-11-25** | SEPs: **2243** (obligatorio) · **2549** (caché opcional) · **414** (W3C Trace Context)

---

## Instalación

```sh
# Fastify + stdio (local, sin red)
pnpm add @mcp-auto-expose/fastify @mcp-auto-expose/stdio

# Express + Streamable HTTP
pnpm add @mcp-auto-expose/express @mcp-auto-expose/http
```

---

## Quickstart — Fastify + stdio

```ts
import Fastify from "fastify";
import { autoExpose } from "@mcp-auto-expose/fastify";
import { startStdio } from "@mcp-auto-expose/stdio";

const app = Fastify({ logger: { stream: process.stderr } });
await app.register(autoExpose);

app.get("/api/users", async () => [{ id: "u1", name: "Ana" }]);

app.post(
  "/api/users",
  {
    schema: {
      body: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    },
  },
  async (req) => ({ id: "u2", ...(req.body as object) }),
);

await app.listen({ port: 3000, host: "127.0.0.1" });

// Expone las tools vía MCP stdio para agentes locales
const tools = app.mcpAutoExpose.tools();
await startStdio({ name: "my-server", version: "1.0.0", tools });
```

---

## Quickstart — Express + Streamable HTTP

```ts
import express, { Router } from "express";
import { autoExpose, mcpExpose } from "@mcp-auto-expose/express";
import { mountMcpExpress } from "@mcp-auto-expose/http/express";

const app = express();
app.use(express.json());
const handle = autoExpose(app);

const router = Router();
router.get("/users", mcpExpose({ description: "List users" }), (_req, res) => {
  res.json([{ id: "u1", name: "Ana" }]);
});
app.use("/api", router);

const { router: mcpRouter } = mountMcpExpress({
  name: "my-server",
  version: "1.0.0",
  tools: handle.tools(),
  allowedOrigins: [],
  apiBaseUrl: "http://127.0.0.1:3000",
});
app.use(mcpRouter);

app.listen(3000, "127.0.0.1");
// MCP endpoint disponible en http://127.0.0.1:3000/mcp
```

---

---

## Paquetes del monorepo

| Paquete                    | Descripción                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `@mcp-auto-expose/core`    | Motor de auto-descubrimiento: `generateToolName`, `flattenSchema`, `makeHttpCaller` |
| `@mcp-auto-expose/fastify` | Plugin Fastify con `onRoute` hook                                                   |
| `@mcp-auto-expose/express` | Walker recursivo `app._router.stack` + decoradores `mcpExpose` / `mcpHeader`        |
| `@mcp-auto-expose/stdio`   | Transporte stdio con `stdoutGuard` (redirige `console.*` → stderr)                  |
| `@mcp-auto-expose/http`    | Streamable HTTP (POST+SSE); binders para Express y Fastify                          |

---

## Estado

| Característica                               | Estado                                     |
| -------------------------------------------- | ------------------------------------------ |
| Protocolo MCP                                | `2025-11-25`                               |
| SEP-2243 headers obligatorios                | Implementado (default on)                  |
| SEP-2549 cache hints (`ttlMs`, `cacheScope`) | Implementado (opt-in via `toolsListCache`) |
| SEP-414 W3C Trace Context → backend          | Implementado                               |
| Invocación real de ruta backend              | Implementado (`makeHttpCaller`)            |

---

## Desarrollo

```sh
pnpm dev                         # todos los paquetes en modo watch
pnpm build                       # compilar todo
pnpm test                        # tests de todos los paquetes
pnpm lint                        # lint con ESLint
pnpm check-types                 # type-check con tsc

# Smoke de integración:
node --import tsx apps/dev-sandbox/src/http-express-main.ts &
node --import tsx apps/dev-sandbox/src/http-client-smoke.ts
```

---

## Patrocinadores

¿Tu empresa depende de `mcp-auto-expose`? Considera patrocinar el proyecto
para garantizar su mantenimiento y desarrollo continuo.

[![GitHub Sponsors](https://img.shields.io/badge/GitHub%20Sponsors-❤-ea4aaa?logo=github)](https://github.com/sponsors/SoyTiyi)
[![Polar.sh](https://img.shields.io/badge/Polar.sh-Sponsor-blue?logo=polar)](https://polar.sh/mcp-auto-expose)

---

MIT License — ver [LICENSE](LICENSE)
