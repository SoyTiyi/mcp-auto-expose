# Constitución del Proyecto mcp-auto-expose

## Principios
1. Spec-First: ningún código se escribe sin un spec aprobado en `specs/`.
2. Fuente de verdad: `docs/documentation.txt` es el documento rector.
3. Logs siempre a stderr; stdout reservado para JSON-RPC.
4. UTF-8 sin BOM en todos los archivos.
5. TypeScript strict en todos los paquetes.

## Proceso de contribución
- Proponer cambio → actualizar spec en `specs/` → abrir PR con spec primero.
- Código solo tras aprobación del spec.
- TDD: test rojo → implementación → test verde → commit.
