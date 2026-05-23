import { warn } from "./warn.js";

export function localhostWarn(enabled: boolean = true): void {
  if (!enabled) return;
  const host = process.env["HOST"] ?? process.env["BIND_ADDRESS"] ?? "";
  if (host === "0.0.0.0") {
    warn("non-localhost-bind", { host, hint: "bind to 127.0.0.1 to prevent DNS rebinding" });
  }
}
