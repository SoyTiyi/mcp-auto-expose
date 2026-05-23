const PREFIX = "[mcp-auto-expose:express]";

export function warn(code: string, ctx: Record<string, unknown>): void {
  const line = `${PREFIX} ${code} ${JSON.stringify(ctx)}\n`;
  process.stderr.write(line);
}
