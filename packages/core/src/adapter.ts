import type { RouteDescriptor, ToolCallResult as CallToolResult } from "./types.js";
import type { ReconstructedRequest } from "./reconstructRequest.js";

/**
 * Contrato canónico que cualquier adaptador de framework debe implementar.
 *
 * - `discover` debe ser idempotente: llamarlo varias veces sobre el mismo host
 *   debe producir el mismo resultado.
 * - `dispatch` es opcional; solo es necesario para ejecución in-process sin fetch HTTP.
 */
export interface FrameworkAdapter<THost = unknown> {
  readonly name: string;
  /** Idempotente: descubre las rutas expuestas por el host. */
  discover(host: THost): RouteDescriptor[] | Promise<RouteDescriptor[]>;
  /** Opcional: despacha la request directamente sin llamada HTTP. */
  dispatch?(descriptor: RouteDescriptor, request: ReconstructedRequest): Promise<CallToolResult>;
}
