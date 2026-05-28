import type { MCPTool } from "./types.js";

export class ToolRegistry {
  private readonly _tools = new Map<string, MCPTool>();

  register(tool: MCPTool): void {
    const name = tool.name;
    if (this._tools.has(name)) {
      let suffix = 2;
      while (this._tools.has(`${name}_${suffix}`)) suffix++;
      const newName = `${name}_${suffix}`;
      process.stderr.write(
        `[mcp-auto-expose] tool name collision "${name}" — renamed to "${newName}"\n`,
      );
      tool = { ...tool, name: newName };
    }
    this._tools.set(tool.name, tool);
  }

  list(): MCPTool[] {
    return [...this._tools.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  clear(): void {
    this._tools.clear();
  }
}
