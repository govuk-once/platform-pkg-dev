# platform-pkg-dev

Core development tooling for the Connect platform. Every Connect package depends on this one.

1. **Scaffolds** new packages with `dev init`.
2. **Owns the toolchain** — every version lives in `versions.json`, and `dev sync` keeps each package matching it.

## Quick start

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/govuk-once/platform-pkg-dev/main/start.sh)" -- \
  --dir connect-foo \
  --name connect-foo \
  --team identity \
  --role connect-development-admin
```

`--role` assumes a GDS role and authorises CodeArtifact before install.
`--dir` names a folder to create; without it an empty directory is used as-is.

For a package that already has `platform-pkg-dev` installed:

```sh
pnpm dev init
```

### Local development

`start.sh` defaults to a published `platform-pkg-dev`. To bootstrap against a local checkout:

```sh
bash platform-pkg-dev/start.sh --local \
  --dir connect-trial \
  --name connect-trial \
  --team connect-team \
  --role connect-development-admin
```

`--local` resolves `platform-pkg-dev` as `file:../platform-pkg-dev` from the new package directory.

## Commands

| Command                                 | Description                                                               |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm dev init`                         | Scaffold a new package                                                    |
| `pnpm dev init --detach`                | Scaffold a standalone package with no platform-pkg-dev dependency         |
| `pnpm dev sync`                         | Re-pin managed deps, then `pnpm install`                                  |
| `pnpm dev build`                        | Compile with the pinned TypeScript                                        |
| `pnpm dev test`                         | Run Vitest once                                                           |
| `pnpm dev test:watch`                   | Re-run affected tests on save                                             |
| `pnpm dev lint`                         | oxlint (type-aware) with shared rules                                     |
| `pnpm dev format`                       | oxfmt (`--check` to verify only)                                          |
| `pnpm dev typecheck`                    | `tsc --noEmit`                                                            |
| `pnpm dev hooks install`                | Install pre-commit locally, wire `.githooks`, pre-build hook environments |
| `pnpm dev doctor`                       | Verify pinned tool versions                                               |
| `pnpm dev cdk:init`                     | Scaffold the CDK app                                                      |
| `pnpm dev synth`                        | Assume role + `cdk synth`                                                 |
| `pnpm dev scan`                         | Synth then checkov                                                        |
| `pnpm dev pre-commit`                   | Run commit-stage hooks on demand                                          |
| `pnpm dev pre-push`                     | Run push-stage hooks on demand                                            |
| `pnpm dev assumeRole [role]`            | Assume a GDS role (defaults to `once.aws.roles` in package.json)          |
| `pnpm dev codeArtifactAuthorise [role]` | Assume role + authorise CodeArtifact                                      |

## How a package tracks platform-pkg-dev

| Mechanism     | Files                                                            | Updates                                                          |
| ------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Extends**   | `tsconfig.json`, `.oxlintrc.json`                                | Immediately — they point at platform-pkg-dev's base configs      |
| **Delegates** | `.githooks/pre-commit`, `.githooks/pre-push`                     | Immediately — they hand off to `platform-pkg-dev/hooks/dev-hook` |
| **Generated** | `.pre-commit-config.yaml`, `.oxfmtrc.json`, `.nvmrc`, `.vscode/` | On `dev sync` — no `extends` mechanism, so regenerated outright  |

Seed files (`README.md`, `src/`, `.gitignore`) are written once and belong to the package.

## Version pins

Every version lives in [`versions.json`](versions.json). `dev sync` enforces them across packages. `dev sync --check` reports drift without changing anything.

Packages declare CDK deps in their own `package.json` (pinned exactly) because pnpm's strict `node_modules` requires it for `import` resolution. `dev sync` keeps those pins equal to `versions.json`.

## Further reading

- [Overview](docs/overview.md) — why this package exists, what it enables, security and best practices
- [Scaffolding and init](docs/init.md) — what `dev init` writes, `dev cdk:init`, `dev synth` and `dev scan`
- [Toolchain](docs/toolchain.md) — build, wrappers, dual ESM/CJS markers, upgrading platform-pkg-dev
- [Git hooks](docs/hooks.md) — pre-commit setup, hook stages, config generation, extend overlays
- [Linting](docs/linting.md) — oxlint, type-aware rules, fix-on-save
- [Roadmap](docs/roadmap.md) — detach mode, pipeline integration, SAM, security hook tests
