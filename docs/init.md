# Scaffolding and init

## What `dev init` writes

| File                                     | Notes                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `package.json`                           | No `scripts` block; `type: module`, `sideEffects: false`, `files: ["dist"]` |
| `.nvmrc`                                 | Node 24                                                                     |
| `.gitignore`                             | Gains CDK entries when CDK is selected                                      |
| `.pre-commit-config.yaml`                | Generated from platform-pkg-dev's master config                             |
| `pre-commit.extend.yaml.example`         | Per-package hook overrides, renamed to activate                             |
| `.oxlintrc.json`                         | Extends `platform-pkg-dev/oxlint.base.json`                                 |
| `.oxfmtrc.json`                          | Generated formatter config                                                  |
| `.githooks/`                             | pre-commit and pre-push, delegating to pre-commit                           |
| `.vscode/`                               | Recommends the oxc extension, fixes on save                                 |
| `tsconfig.json`                          | Extends `platform-pkg-dev/tsconfig.base.json`                               |
| `README.md`, `src/index.ts`              | Starting point                                                              |
| `tsconfig.esm.json`, `tsconfig.cjs.json` | Published packages only                                                     |

Nothing is written until the environment check passes (`git` and `pnpm` present). A failed check leaves the target directory untouched.

Existing files are not overwritten unless `--force` is passed. See `dev init --help` for all flags.

### After writing files

- **Formats what it wrote.** oxfmt has its own key order for `package.json`, and without this a fresh package would fail `dev format --check` immediately.
- **Runs `pnpm install`.** Until it has, there is no `dev` binary. `--no-install` skips it.

## `dev init --detach`

Scaffolds a fully standalone package with no ongoing dependency on platform-pkg-dev.

```sh
pnpm dev init --detach --name connect-standalone --team identity --role connect-dev-admin
```

What changes compared to a normal init:

| Aspect                        | Normal                                         | Detached                                         |
| ----------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `platform-pkg-dev` dependency | devDependency                                  | Not present                                      |
| `tsconfig.json`               | Extends `platform-pkg-dev/tsconfig.base.json`  | Full config inlined                              |
| `.oxlintrc.json`              | Extends `platform-pkg-dev/oxlint.base.json`    | Full rules inlined                               |
| `vitest.config.ts`            | Imports from `platform-pkg-dev/vitest`         | Self-contained config                            |
| `.githooks/`                  | Delegates to `platform-pkg-dev/hooks/dev-hook` | Runs pre-commit directly                         |
| `.pre-commit-config.yaml`     | Local hooks use `dev` CLI wrappers             | Local hooks use tools directly                   |
| `dev sync`                    | Enforces pins on every commit                  | Not present                                      |
| `package.json` scripts        | None (uses `dev` CLI)                          | Direct tool commands (`tsc`, `vitest run`, etc.) |

The package owns all configuration from day one and can edit any file freely.

Also works with `start.sh`:

```sh
bash platform-pkg-dev/start.sh --local --detach --dir connect-standalone --name connect-standalone --team identity --role connect-dev-admin
```

### The bootstrap manifest

The throwaway `package.json` that `start.sh` writes carries `once.bootstrap: true`. This is the only reason `init` replaces it — any other existing `package.json` is left alone.

## `dev cdk:init`

Separate from `dev init` because it needs the CDK CLI, which is only available after the first `pnpm install`.

```sh
pnpm dev cdk:init          # --dir <name> to use something other than cdk/
```

It runs `cdk init --generate-only`, removes what platform-pkg-dev already owns (the generated `package.json`, `tsconfig.json`, Jest config, `test/`, `.gitignore`, `README.md`), then writes `bin/app.ts`, `lib/main.stack.ts` and `cdk/tsconfig.json` from templates. `cdk.json` is kept — it carries ~90 context feature flags that must match the CDK version.

The `app` field in `cdk.json` is repointed to `node bin/app.ts` (Node's type stripping, no compile step).

Inside the `cdk/` directory, relative imports use `.ts` extensions. Everywhere else, imports end `.js`.

When CDK is selected during `dev init`, `cdk:init` runs automatically after install.

## `dev synth` and `dev scan`

```sh
pnpm dev synth              # every stack
pnpm dev synth UdpMainStack # one stack
pnpm dev scan               # synth, then checkov
pnpm dev scan CKV_AWS_158   # one check
```

`dev synth` assumes a GDS role and runs `cdk synth`. `dev scan` does that then runs checkov over the output.

Roles are declared per package in `package.json`:

```jsonc
"once": {
  "team": "platform",
  "aws": { "region": "eu-west-2", "roles": { "dev": "connect-udp-development-admin" } }
}
```

One configured role is used without ceremony. With more than one, the choice must be explicit (`--env` or `ENV`).

Credentials are parsed, never `eval`ed. They never touch disk or appear in process arguments. The role is verified with `sts get-caller-identity` before anything long-running starts. `cdk.out` is removed first so stale templates from deleted stacks are not re-scanned.
