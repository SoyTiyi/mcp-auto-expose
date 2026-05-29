import express, { Router } from "express";
import { z } from "zod";
import { autoExpose, mcpExpose, mount } from "@mcp-auto-expose/express";
import { startStdio } from "@mcp-auto-expose/stdio";

const app = express();
app.use(express.json());

const handle = autoExpose(app, { strictSchema: true });

const router = Router();

router.get("/users", mcpExpose({ description: "List all users" }), (_req, res) => {
  res.json([]);
});

router.get(
  "/users/:id",
  mcpExpose({
    params: z.object({ id: z.string() }),
    description: "Get user by ID",
  }),
  (_req, res) => {
    res.json({});
  },
);

router.post(
  "/users",
  mcpExpose({
    body: z.object({ name: z.string(), email: z.string().email() }),
    description: "Create a new user",
  }),
  (_req, res) => {
    res.status(201).json({});
  },
);

app.use("/api", router);
mount(handle, "/api", router); // explicit mount registration

await startStdio({
  name: "express-sandbox",
  version: "0.0.0",
  tools: handle.tools(),
});
