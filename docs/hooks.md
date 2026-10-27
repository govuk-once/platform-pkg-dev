# Git hooks

Hooks are run by [pre-commit](https://pre-commit.com), which installs each hook repo into its own isolated environment at a pinned revision. semgrep, checkov and detect-secrets are never installed globally and cannot drift.

pre-commit itself is installed automatically into `node_modules/.bin` by `dev hooks install` — no external install needed.

## Setup

```sh
dev hooks install     # installs pre-commit, sets core.hooksPath, pre-builds hook environments
dev hooks status
dev hooks uninstall
```

Per-clone: `core.hooksPath` is local git config, and hook environments live in `~/.cache/pre-commit`.

`install` pre-builds environments up front — pre-commit would otherwise do it lazily on the first commit.

## Hook stages

**On commit** — file hygiene and cheap safety nets first:

| Group     | Hooks                                                                                                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| hygiene   | `trailing-whitespace`, `end-of-file-fixer`, `mixed-line-ending`                                                                              |
| validity  | `check-yaml`, `check-json`, `check-toml`, `check-merge-conflict`, `check-case-conflict`, `check-symlinks`, `check-executables-have-shebangs` |
| safety    | `check-added-large-files`, `detect-private-key`, `no-commit-to-branch` (main/master)                                                         |
| secrets   | `detect-secrets`, `semgrep` (`p/typescript`, `p/secrets`)                                                                                    |
| toolchain | `dev lint`, `dev typecheck`                                                                                                                  |

**On push** — the slow half: `checkov` and `dev test`.

Both stages are preceded by `dev sync --check`.

## How hooks run

`.githooks/` scripts are committed and hand off to `platform-pkg-dev/hooks/dev-hook`:

```sh
exec pre-commit hook-impl --config=.pre-commit-config.yaml --hook-type=pre-commit -- "$@"
```

`dev sync --check` runs **before** pre-commit, not inside the chain. pre-commit parses the config once at start-up, so a stale config must be caught beforehand.

## Config generation and overrides

`.pre-commit-config.yaml` is rendered by `dev sync` from the [master config](../templates/pre-commit/master.yaml). pre-commit itself has no `extends` mechanism, so the file is generated outright.

Package-specific extensions go in `pre-commit.extend.yaml` (rename from `.example` to activate). When present, `dev sync` merges it into the generated config — lists are appended, regexes are joined with alternation, so a package adds to the master rather than replacing it. Extensions are keyed by hook id:

```yaml
detect-secrets:
  exclude:
    - ^src/testdata/.*$

semgrep:
  args:
    - --config=p/owasp-top-ten
```

- `exclude` and `files` take a **list** — entries are joined into one alternation and merged with the master.
- `args`, `additional_dependencies` and `types_or` append.
- Anything else replaces.
- A `repos:` key adds entirely new hook repos.

Naming a nonexistent hook is an error listing valid ids.

## Notable exclusions

- `detect-secrets` skips lockfiles (base64 integrity hashes trip the high-entropy detector).
- `detect-secrets` skips lines matching its own name in `versions.json` and `TOP_SECRET` classification labels.
- `check-json` skips JSONC files (`.oxlintrc.json`, `.oxfmtrc.json`, `.vscode/*.json`, `tsconfig*.json`).

## Shell extend scripts

`.githooks/pre-commit.extend.sh` and `.githooks/pre-push.extend.sh` run after the shared chain passes. A non-zero exit blocks the commit or push. Rename from `.example` to activate.
