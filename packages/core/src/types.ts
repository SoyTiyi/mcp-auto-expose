export type HTTPMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export interface MCPToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
}

export interface RouteSchema {
  body?: Record<string, unknown>;
  querystring?: Record<string, unknown>;
  params?: Record<string, unknown>;
  description?: string;
  summary?: string;
  tags?: string[];
  hide?: boolean;
}

export interface RouteDescriptor {
  framework: "fastify" | "express";
  method: HTTPMethod;
  url: string;
  schema?: RouteSchema;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: MCPToolInputSchema;
  _source: {
    framework: "fastify" | "express";
    method: HTTPMethod;
    url: string;
  };
}
