# {{packageName}}

Owned by **{{team}}**.

Scaffolded by `dev init --detach`. This package is standalone — it does not
depend on platform-pkg-dev and owns all of its configuration directly.

## Getting started

```sh
nvm use
pnpm install
git config core.hooksPath .githooks
```

## Commands

| Command              | What it does                             |
| -------------------- | ---------------------------------------- |
| `pnpm run build`     | Compile with TypeScript                  |
| `pnpm test`          | Run Vitest once                          |
| `pnpm run lint`      | Run oxlint (type-aware) with local rules |
| `pnpm run format`    | Run oxfmt (`--check` to verify only)     |
| `pnpm run typecheck` | Type-check without emitting              |
| {{cdkSection}}       |

## Git hooks

`.githooks/` runs [pre-commit](https://pre-commit.com) hooks on commit and push.

| Stage  | Runs                                                  |
| ------ | ----------------------------------------------------- |
| commit | file hygiene, detect-secrets, format, lint, typecheck |
| push   | semgrep, checkov, test                                |

## Configuration

All configuration files are owned by this package and can be edited directly:

- `tsconfig.json` — TypeScript config (no extends)
- `.oxlintrc.json` — lint rules (no extends)
- `vitest.config.ts` — test config (no external import)
- `.pre-commit-config.yaml` — hook config (edit freely)
