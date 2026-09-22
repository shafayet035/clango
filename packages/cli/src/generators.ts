/**
 * Project and app scaffolding.
 *
 * Templates are pure functions returning `{ path, contents }`, so what a generator would write is
 * testable without touching a filesystem — and so the CLI can decide whether to overwrite.
 */

/** A file a generator would write. */
export interface GeneratedFile {
  /** Path relative to the project root. */
  readonly path: string;
  readonly contents: string;
  /** `true` when the file must not be overwritten without asking. */
  readonly skipIfExists?: boolean;
}

/** Options accepted by {@link projectFiles}. */
export interface InitOptions {
  /** Project name, used in `package.json`, `wrangler.jsonc` and the D1 database name. */
  readonly name: string;
  /**
   * Dependency spec for the framework packages.
   *
   * Defaults to `workspace:*`, because the packages are not published yet; a release would pin a
   * version range here instead.
   */
  readonly frameworkVersion?: string;
  /** Include the admin SPA wiring. Defaults to `true`. */
  readonly admin?: boolean;
  /** Include the REST API wiring. Defaults to `true`. */
  readonly api?: boolean;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Files for `clango init`. */
export function projectFiles(options: InitOptions): readonly GeneratedFile[] {
  const version = options.frameworkVersion ?? "workspace:*";
  const database = `${options.name}-db`;

  const dependencies: Record<string, string> = {
    "@clango/core": version,
    "@clango/orm": version,
    hono: "^4.9.6",
  };
  if (options.api !== false) dependencies["@clango/api"] = version;
  if (options.admin !== false) {
    dependencies["@clango/admin-api"] = version;
    dependencies["@clango/admin-ui"] = version;
  }

  const devDependencies: Record<string, string> = {
    "@cloudflare/vitest-plugin": "^1.2.2",
    "@clango/cli": version,
    "@clango/migrate": version,
    typescript: "^5.9.3",
    vitest: "^4.1.11",
    wrangler: "^4.136.2",
  };

  const worker: Record<string, unknown> = {
    $schema: "node_modules/wrangler/config-schema.json",
    name: options.name,
    main: "src/index.ts",
    compatibility_date: "2026-09-22",
    observability: { enabled: true },
    d1_databases: [
      {
        binding: "DB_MAIN",
        database_name: database,
        database_id: "00000000-0000-0000-0000-000000000000",
        migrations_dir: "migrations/DB_MAIN",
      },
    ],
  };

  const routes = [
    `app.get("/health", async (c) => {`,
    `  const row = await createD1Router(config, c.env).database("DB_MAIN").db`,
    `    .prepare("SELECT 1 AS ok")`,
    `    .first<{ ok: number }>();`,
    `  return c.json({ status: "ok", database: row?.ok === 1 });`,
    `});`,
  ];
  if (options.api !== false) routes.push(`mountApi(app, config);`);
  if (options.admin !== false) routes.push(`mountAdmin(app, config);`);

  return [
    {
      path: "package.json",
      contents: json({
        name: options.name,
        private: true,
        type: "module",
        scripts: {
          dev: "wrangler dev",
          deploy: "wrangler deploy",
          test: "vitest run",
          typecheck: "tsc --noEmit",
          types: "wrangler types",
          "db:makemigrations": "clango makemigrations",
          "db:migrate:local": "clango migrate --local",
        },
        dependencies: sortKeys(dependencies),
        devDependencies: sortKeys(devDependencies),
      }),
    },
    { path: "wrangler.jsonc", contents: json(worker) },
    {
      path: "clango.config.ts",
      contents: `import { defineConfig } from "@clango/core";

import app from "./src/app";

export default defineConfig({
  apps: [app],
  databases: { DB_MAIN: { binding: "DB_MAIN" } },${options.admin === false ? "" : "\n  admin: { enabled: true },"}
});
`,
    },
    {
      path: "src/app.ts",
      contents: `import { defineApp } from "@clango/core";

import { Note } from "./models";

export default defineApp({ name: "${options.name}", models: [Note], database: "DB_MAIN" });
`,
    },
    {
      path: "src/models.ts",
      contents: `import { defineModel, fields } from "@clango/core";

export const Note = defineModel("${options.name}.Note", {
  fields: {
    title: fields.string({ max: 200 }),
    body: fields.text({ searchable: true, optional: true }),
    pinned: fields.boolean({ default: false }),
  },
  meta: { ordering: ["-createdAt"], labelField: "title" },
${options.api === false ? "" : "  api: { enabled: true },\n"}});
`,
    },
    {
      path: "src/index.ts",
      contents: `${
        options.admin === false
          ? ""
          : 'import { mountAdmin, type ClangoAuthVariables } from "@clango/admin-api";\n'
      }${options.api === false ? "" : 'import { mountApi } from "@clango/api";\n'}import { createD1Router } from "@clango/orm";
import { Hono } from "hono";

import config from "../clango.config";

// The admin stores the resolved user on the context, so the app has to declare that variable.
const app = new Hono<${
        options.admin === false
          ? "{ Bindings: Env }"
          : "{ Bindings: Env; Variables: ClangoAuthVariables }"
      }>();

${routes.join("\n\n")}

export default app;
`,
    },
    {
      path: "tsconfig.json",
      contents: json({
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022"],
          module: "ESNext",
          moduleResolution: "bundler",
          moduleDetection: "force",
          // Bindings come from worker-configuration.d.ts, which `wrangler types` generates.
          types: [],
          strict: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts", "worker-configuration.d.ts"],
      }),
    },
    {
      path: "vitest.config.ts",
      contents: `import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
});
`,
    },
    {
      path: "migrations/DB_MAIN/.gitkeep",
      contents: "",
      skipIfExists: true,
    },
    {
      path: ".gitignore",
      contents: `node_modules/
.wrangler/
dist/
.dev.vars
`,
      skipIfExists: true,
    },
    {
      path: "README.md",
      contents: `# ${options.name}

A Clango app.

\`\`\`sh
pnpm install
pnpm db:makemigrations
pnpm db:migrate:local
pnpm dev
\`\`\`

The D1 binding in \`wrangler.jsonc\` carries a placeholder \`database_id\`: run
\`wrangler d1 create ${database}\` and paste the real id before deploying.
`,
    },
  ];
}

/** Files for `clango startapp <name>`. */
export function appFiles(name: string): readonly GeneratedFile[] {
  return [
    {
      path: `src/apps/${name}/app.ts`,
      contents: `import { defineApp } from "@clango/core";

import { ${pascalCase(name)}Item } from "./models";

export default defineApp({ name: "${name}", models: [${pascalCase(name)}Item] });
`,
    },
    {
      path: `src/apps/${name}/models.ts`,
      contents: `import { defineModel, fields } from "@clango/core";

export const ${pascalCase(name)}Item = defineModel("${name}.Item", {
  fields: {
    title: fields.string({ max: 200 }),
    notes: fields.text({ optional: true }),
  },
  meta: { ordering: ["-createdAt"], labelField: "title" },
  api: { enabled: true },
});
`,
    },
    {
      path: `src/apps/${name}/admin.ts`,
      contents: `import { registerAdmin } from "@clango/admin-api";

import { ${pascalCase(name)}Item } from "./models";

registerAdmin(${pascalCase(name)}Item, {
  listDisplay: ["title"],
  searchFields: ["title", "notes"],
});
`,
    },
    {
      path: `src/apps/${name}/README.md`,
      contents: `# ${name}

Register this app in \`clango.config.ts\`:

\`\`\`ts
import ${name} from "./src/apps/${name}/app";

export default defineConfig({ apps: [/* … */, ${name}] });
\`\`\`
`,
      skipIfExists: true,
    },
  ];
}

function pascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
}

function sortKeys(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
