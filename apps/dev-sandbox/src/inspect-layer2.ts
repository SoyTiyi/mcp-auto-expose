import express, { Router } from "express";

const app = express();
const router = Router();

router.get("/users", (_req, res) => res.json([]));
app.use("/api", router);

const a = app as unknown as { router?: { stack: unknown[] }; _router?: { stack: unknown[] } };
const stack = a.router?.stack ?? a._router?.stack ?? [];
for (const layer of stack as Array<Record<string, unknown>>) {
  if (layer["name"] === "router") {
    process.stderr.write("layer.slash: " + JSON.stringify(layer["slash"]) + "\n");
    process.stderr.write("layer.keys: " + JSON.stringify(layer["keys"]) + "\n");
    process.stderr.write("layer.params: " + JSON.stringify(layer["params"]) + "\n");
    
    // Check if there's a _path or similar hidden property
    const proto = Object.getPrototypeOf(layer) as object;
    process.stderr.write("proto keys: " + Object.getOwnPropertyNames(proto).join(", ") + "\n");
    
    // Try to see if the matcher has a closure variable we can read
    const matchers = layer["matchers"] as Array<Record<string, unknown>>;
    if (matchers?.[0]) {
      const m = matchers[0];
      process.stderr.write("all matcher own props: " + Object.getOwnPropertyNames(m).join(", ") + "\n");
      // Does the matcher have a source string?
      const src = m["regexp"] as RegExp | undefined;
      if (src) process.stderr.write("matcher.regexp.source: " + src.source + "\n");
    }
  }
}

// Also check if there's a way to get the mount path from the app itself
process.stderr.write("\nmountpath: " + JSON.stringify((app as unknown as Record<string, unknown>)["mountpath"]) + "\n");
