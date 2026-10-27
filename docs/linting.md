# Linting

oxlint, not ESLint. `typescript-eslint` refuses to load against TypeScript 7 — oxlint parses TypeScript with its own Rust parser and has no dependency on the `typescript` package.

## Type-aware rules

`oxlint-tsgolint` (built on tsgo, the TypeScript 7 native compiler) provides type-aware rules:

```
$ dev lint
src/probe.ts:6:3: error typescript(no-floating-promises): Promises must be awaited
```

`dev lint` turns on `--type-aware` automatically when a `tsconfig.json` exists, and keeps that flag when you pass others (`dev lint --fix` still lints the whole package with type information).

## Config

Rules live in [`oxlint.base.json`](../oxlint.base.json). Each package's `.oxlintrc.json` extends it:

```json
{ "extends": ["./node_modules/platform-pkg-dev/oxlint.base.json"], "rules": {} }
```

`oxlint-tsgolint` is a managed pin in every package's `package.json` because oxlint resolves its type-aware engine from the linted package's `node_modules`, not from platform-pkg-dev's. `dev sync` keeps it pinned.

## Fixing

```sh
dev lint --fix              # safe fixes, written to disk
dev lint --fix-suggestions  # also applies behaviour-changing suggestions
```

Not every rule has an autofix.

## Fix-on-save

`dev init` scaffolds VS Code settings for fix-on-save. `.vscode/extensions.json` recommends `oxc.oxc-vscode`, and `.vscode/settings.json` enables `source.fixAll.oxc` on save plus type-aware diagnostics. Both files are committed. Without the extension the settings are inert.
