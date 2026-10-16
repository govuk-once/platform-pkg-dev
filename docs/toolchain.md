# Toolchain

## Wrappers

Under pnpm, only direct dependencies get binaries linked into `node_modules/.bin`. A package depending on `platform-pkg-dev` has no `tsc` or `vitest` on its path — the `dev` wrappers resolve binaries from platform-pkg-dev's own install and run them.

They run from the nearest package root, not the caller's working directory, so calling them from inside `src/` behaves identically to calling them from the top. Override with `--cwd <path>` or `DEV_CWD`.

## Build markers (dual ESM/CJS)

Node decides whether a `.js` file is ESM or CJS by the nearest `package.json` `type` field. A published package with `"type": "module"` treats everything under `dist/` as ESM, including `dist/cjs` where `require()` then fails.

`dev build` writes `dist/cjs/package.json` (`{"type":"commonjs"}`) and `dist/esm/package.json` (`{"type":"module"}`) automatically after a successful dual build. Skipped if either compile fails.

## Upgrading platform-pkg-dev

`dev sync` checks for a newer platform-pkg-dev before doing anything else. It reads a plain-text `VERSION` file:

```
versions.json -> "versionUrl": "https://raw.githubusercontent.com/govuk-once/platform-pkg-dev/main/VERSION"
```

Override with `DEV_VERSION_URL` (including `file:` URLs for local testing). Set `versionUrl` to `null` to disable.

When a newer version is found, it rewrites the spec, installs, and re-runs sync under the new version.

Guards:

- `link:`, `file:` or `workspace:` specs are never rewritten (local development).
- Non-version responses (e.g. HTML error pages) are ignored.
- Failed installs roll back `package.json`.
- `--no-install` and `--no-upgrade` skip the check.
- Unreachable URLs are a silent skip, never an error.

## `dev sync`

```sh
dev sync           # re-pin managed deps, then pnpm install
dev sync --check   # report drift, exit 1, change nothing
dev sync --no-install
```

Enforces `@types/node` for every package, plus `aws-cdk-lib`, `constructs` and `aws-cdk` for packages that already use CDK, plus `packageManager` and `engines.node`.

Specs are compared as literal strings — `^2.266.0` is drift from `2.266.0`. Existing key order is preserved. Unmanaged dependencies are left alone.

## Version pins

Every version lives in [`versions.json`](../versions.json). `src/versions.ts` loads it and fails loudly on a missing entry.

### Why some deps are declared per package

Anything a package `import`s must be in its own `package.json` — pnpm's strict `node_modules` requires it. `dev sync` keeps those pins equal to `versions.json`. One place to change the version; strict resolution and a single copy of CDK preserved.
