# Clango guide

Task-oriented documentation. `docs/SPEC.md` remains the authoritative spec and `docs/DECISIONS.md`
records why things are the way they are.

| Page                                      | What it covers                                              |
| ----------------------------------------- | ----------------------------------------------------------- |
| [Getting started](./getting-started.md)   | Scaffold a project, run it, write your first model          |
| [Models and migrations](./models.md)      | Fields, relations, snapshots, table rebuilds                |
| [REST API](./api.md)                      | Generated CRUD, pagination, filters, search                 |
| [Admin](./admin.md)                       | The metadata endpoint, the SPA, permissions, widgets, locks |
| [Auth](./auth.md)                         | The adapter contract, permissions, groups, superusers       |
| [Files, tasks and cache](./background.md) | R2 uploads, Queues, cron, Workflows, KV                     |
| [Scaling](./scaling.md)                   | Many databases, tenancy, read replication, the driver seam  |

There is no hosted documentation site yet; the pages here are plain Markdown so they can be rendered
by whichever generator M7's follow-up picks (D-061).
