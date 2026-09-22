import { mountAdmin, type ClangoAuthVariables } from "@clango/admin-api";
import { mountAuth } from "@clango/auth";
import { mountApi } from "@clango/api";
import { VERSION } from "@clango/core";
import { createD1Router, schemaFor } from "@clango/orm";
import { Hono } from "hono";

import config from "../clango.config";
import "./admin";

const app = new Hono<{ Bindings: Env; Variables: ClangoAuthVariables }>();

app.get("/", (c) => c.json({ name: "clango-example-blog", clango: VERSION }));

app.get("/health", async (c) => {
  const router = createD1Router(config, c.env);
  const schema = schemaFor(config);
  const row = await router.database("DB_MAIN").db.prepare("SELECT 1 AS ok").first<{ ok: number }>();
  return c.json({
    status: "ok",
    database: row?.ok === 1,
    models: [...schema.byModel.keys()],
  });
});

mountAuth(app, config);
mountApi(app, config);
mountAdmin(app, config);

export default app;
