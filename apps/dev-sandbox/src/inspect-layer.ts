import express, { Router } from "express";

const app = express();
const router = Router();

router.get("/users", (_req, res) => res.json([]));
app.use("/api", router);

const a = app as unknown as { router?: { stack: unknown[] }; _router?: { stack: unknown[] } };
const stack = a.router?.stack ?? a._router?.stack ?? [];
for (const layer of stack as Array<Record<string, unknown>>) {
  if (layer["name"] === "router") {
    const keys = Object.keys(layer);
    process.stderr.write("router layer keys: " + keys.join(", ") + "\n");
    process.stderr.write("layer.path: " + String(layer["path"]) + "\n");
    process.stderr.write("layer.regexp: " + String(layer["regexp"]) + "\n");
    const matchers = layer["matchers"];
    process.stderr.write("has matchers: " + (matchers !== undefined) + "\n");
    if (Array.isArray(matchers)) {
      process.stderr.write("matchers count: " + matchers.length + "\n");
      for (const m of matchers) {
        process.stderr.write("  matcher toString: " + String(m).slice(0, 300) + "\n");
        process.stderr.write("  matcher keys: " + Object.keys(m as object).join(", ") + "\n");
        const mAny = m as Record<string, unknown>;
        for (const k of ["regexp", "pattern", "path", "keys", "source"]) {
          if (mAny[k] !== undefined)
            process.stderr.write(`  matcher.${k}: ` + JSON.stringify(mAny[k]) + "\n");
        }
      }
    }
  }
}
