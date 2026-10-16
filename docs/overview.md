# platform-pkg-dev — overview

## What it is

A single devDependency that owns the development toolchain for every Connect platform package. It provides the `dev` CLI, which scaffolds, builds, lints, tests, formats and secures TypeScript packages to a consistent standard.

## Why it exists

Without a shared toolchain, each package independently chooses and pins its own versions of TypeScript, Vitest, oxlint, CDK and pre-commit hooks. Over time these drift: packages end up on different TypeScript versions, different lint rules, different security scanners — or none at all. Bugs found in one package's config are not fixed in others.

platform-pkg-dev solves this by centralising every version pin in one place (`versions.json`) and distributing them to every package through `dev sync`.

## What it enables

- **Zero-config scaffolding.** `start.sh` bootstraps a new package from scratch. `dev init` writes the full config set. A new developer runs two commands and has a working, secured, linted package.
- **Consistent toolchain.** TypeScript, Vitest, oxlint, oxfmt and CDK versions are pinned centrally. Upgrading one package upgrades all of them.
- **Automated git hooks.** pre-commit is installed locally into `node_modules/.bin` — no global install needed. Hook environments for semgrep, checkov and detect-secrets are managed automatically.
- **CDK scaffolding.** `dev cdk:init` generates a CDK app with the correct feature flags for the pinned CDK version, and `dev synth`/`dev scan` handle role assumption and scanning.

## Security

| Concern                     | How platform-pkg-dev addresses it                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Secret detection**        | `detect-secrets` runs on every commit. Scans file content, not just filenames.                                                                                                           |
| **Static analysis**         | `semgrep` runs `p/typescript` and `p/secrets` rulesets on every push.                                                                                                                    |
| **Infrastructure scanning** | `checkov` scans synthesised CloudFormation templates on every push.                                                                                                                      |
| **Credential handling**     | AWS credentials are parsed from `gds-cli` output, never `eval`ed. Only an allowlist of `AWS_*` variables is passed through. Credentials never touch disk or appear in process arguments. |
| **Dependency pinning**      | Every version is pinned exactly (not ranged). `dev sync --check` fails on drift. No package can silently fall behind.                                                                    |
| **Hook integrity**          | Hook scripts are committed in `.githooks/`, not generated into `.git/hooks`. They are reviewable like any other file.                                                                    |
| **Tool isolation**          | semgrep, checkov and detect-secrets run in pre-commit's isolated environments at pinned revisions. A developer's global installs cannot interfere.                                       |
| **Commit signing**          | `dev hooks install` enables `commit.gpgsign`. The hook chain blocks unsigned commits.                                                                                                    |
| **Branch protection**       | `no-commit-to-branch` prevents direct commits to main/master.                                                                                                                            |

## Best practices enforced

| Practice               | Mechanism                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Type safety**        | `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` in the shared tsconfig                                       |
| **Type-aware linting** | oxlint with `--type-aware` catches `no-floating-promises`, unsafe type assertions, and similar issues that syntax-only linters miss   |
| **Format consistency** | oxfmt runs on commit. No style debates — the formatter decides.                                                                       |
| **No stale config**    | `dev sync --check` runs before every commit and push. A package cannot commit with outdated pins.                                     |
| **Test on push**       | Vitest runs on push so nothing untested leaves the machine, without slowing down commits.                                             |
| **File hygiene**       | Trailing whitespace, mixed line endings, missing EOFs, large files, merge conflict markers and private keys are all caught on commit. |
| **JSONC awareness**    | `check-json` skips files that legitimately use comments (tsconfig, oxlint, VS Code settings).                                         |
