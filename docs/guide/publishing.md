# Consuming Clango from GitHub Packages

Clango is published as **private packages on GitHub Packages**, not to npm. A project installing it
needs three things: a scope that matches the owning account, a token, and one `.npmrc`.

## One-time setup

GitHub Packages requires the package scope to match the account or organisation that publishes it, so
`@clango/*` needs an owner named `clango`:

1. Create a GitHub organisation named `clango` (free) and move or fork the repository into it, **or**
   publish under your own account's scope by renaming the packages.
2. Grant your account write access to the organisation's packages.
3. Authenticate a token that can read (and, to publish, write) packages:

```sh
gh auth refresh -s write:packages,read:packages
```

## Installing into another project

`.npmrc` in the consuming project:

```
@clango:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then:

```sh
pnpm add @clango/core @clango/orm @clango/api @clango/admin-api @clango/cli
```

Use a token with `read:packages` for CI. In GitHub Actions, `secrets.GITHUB_TOKEN` works if the
workflow sets `permissions: packages: read`.

## Releasing

Tagging is the release:

```sh
pnpm build            # every package must build before it can be published
git tag v0.1.0
git push --tags       # .github/workflows/release.yml builds, checks and publishes
```

The workflow publishes with the job's `GITHUB_TOKEN`, runs `pnpm check` first so a broken commit
cannot be released, and skips packages already at that version, so a re-run is safe.

Locally, `pnpm release` does the same publish from your machine.

## How the packages are shaped

- **Development reads source.** In this monorepo `exports` points at `./src/index.ts`, so tests and
  typechecks run without a build step and a change is visible immediately.
- **Published packages read built output.** `publishConfig` swaps the entry points for `./dist` (JS
  plus `.d.ts`) at pack time. `pnpm pack` shows exactly what a consumer receives — worth running
  before a release.
- **Internal dependencies use `workspace:^`**, which pnpm rewrites to `^<version>` when packing.
- **The CLI ships a bundle.** `dist/cli.js` is a self-contained esbuild bundle (with `esbuild` kept
  external and declared as a dependency), so a consumer's `clango` binary needs nothing else.
- **`@clango/admin-ui` ships two things:** `lib/` for the library entry (`mountAdminUi`,
  `registerWidget`) and `dist/` for the prebuilt SPA, which can be pointed at directly:

  ```jsonc
  "assets": { "directory": "node_modules/@clango/admin-ui/dist", "not_found_handling": "single-page-application" }
  ```

## What a consumer must provide

- **Workers runtime types.** The published `.d.ts` files reference `D1Database`, `R2Bucket` and
  friends, which come from the consumer's own `wrangler types` output. Clango declares
  `@cloudflare/workers-types` as a devDependency only, so it is never installed alongside.
- **Bundler-style resolution.** The built output uses extensionless relative imports, so consumers
  need `"moduleResolution": "bundler"` — the default in every Wrangler and Vite project.

## Verifying a release

`pnpm pack` writes tarballs for all twelve packages. Installing those tarballs into a scratch project
and building it is the check that matters: it exercises the published entry points, the declarations,
the CLI binary and the bundling, without touching a registry.
