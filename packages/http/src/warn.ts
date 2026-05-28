const PREFIX = "[mcp-auto-expose:http]";

export function warn(code: string, detail?: unknown): void {
  process.stderr.write(
    `${PREFIX} ${code}${detail !== undefined ? ` ${JSON.stringify(detail)}` : ""}\n`,
  );
}
