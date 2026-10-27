# Roadmap

## ~~`dev init --detach`~~ Done

Scaffold a fully standalone package with no ongoing dependency on platform-pkg-dev. During `start.sh` or `dev init`, `--detach`:

- Inline all config rather than using `extends` (tsconfig, oxlint rules written directly, not pointing at platform-pkg-dev's base files).
- Write hook scripts that run tools directly, not through `dev sync` or the `dev` CLI.
- Not add platform-pkg-dev as a dependency — the package owns everything from day one.
- pre-commit config is rendered as a static file with no `dev sync` regeneration.

Use case: packages that need the initial scaffolding but will diverge intentionally (e.g. external contributions, packages moving out of the Connect org, teams that want the starting point but not the ongoing coupling).

## Per-file overrides in `package.json`

Allow packages to opt specific managed files out of `dev sync` drift detection, so they can be edited in place without sync reverting them:

```jsonc
{
  "once": {
    "override": {
      "preCommitConfig": true,
      "preCommit": true,
      "prePush": true,
    },
  },
}
```

When a file is marked as overridden:

- `dev sync` skips it — no drift check, no regeneration.
- The package owns that file and can edit it freely.
- Other managed files continue to sync normally.

Use case: packages with bespoke hook chains, custom pre-commit configs, or security requirements that differ from the standard set.

## `DevTagAspect` — CDK resource tagging

Expose a CDK Aspect from platform-pkg-dev that automatically tags all resources with tooling metadata:

```ts
import { DevTagAspect } from 'platform-pkg-dev';

Aspects.of(app).add(new DevTagAspect());
```

Tags applied:

- `gds-dev:version` — the platform-pkg-dev version that built this stack.
- `gds-dev:team` — from `once.team` in `package.json`.
- `gds-dev:package` — the package name.

Also add the platform-pkg-dev version as a tag on every Stack by default in the CDK template's `bin/app.ts`, so deployed infrastructure is traceable back to the tooling version that produced it.

## Package-level `dev` config in `package.json`

Add a `dev` key to `package.json` for per-package configuration:

```jsonc
{
  "dev": {
    "sync": { "onCommit": false, "onPush": false },
  },
}
```

First config option: disable `dev sync --check` in the pre-commit and/or pre-push hooks. Allows packages to opt out of automatic sync enforcement while still using the rest of the toolchain.

## Security hook test suites

Build test cases that deliberately trigger failures in checkov, semgrep and detect-secrets to verify they are catching what they claim to catch. Currently these hooks pass silently — there is no proof they would fail on a real issue.

- checkov: deploy a CFN template with a known violation (e.g. unencrypted S3 bucket) and assert the scan fails.
- semgrep: commit code with a known `p/typescript` or `p/secrets` match and assert the hook catches it.
- detect-secrets: commit a file containing a high-entropy string or known secret pattern and assert detection.

These run as part of platform-pkg-dev's own test suite, not in consumer packages.

## AWS template testing

Add support for testing CDK/CloudFormation templates with assertions:

- Example test files in templates showing how to assert on synthesised resources.
- Entry point in the CLI (`dev test:infra` or similar) that synthesises and runs template assertions.
- CDK `Template.fromStack()` patterns with worked examples.

## SAM support

Add SAM as a scaffolding option alongside CDK:

- `dev init --sam` or `dev sam:init` to scaffold a SAM app.
- `template.yaml` generation with sensible defaults.
- `dev sam:build`, `dev sam:local` wrappers.
- Integration with the existing `dev scan` flow (checkov over SAM templates).

## Pipeline integration

Provide examples and entry points for running the same checks in CI/CD pipelines that run locally:

- Example GitHub Actions / AWS CodePipeline workflow files.
- `dev ci:pre-commit` and `dev ci:pre-push` commands (or documented invocations) that run the full hook chains in a pipeline context.
- Same rules, same scripts, same versions — nothing should be caught in the pipeline that was not caught locally.

## Multiple AWS roles

Extend the `once.aws.roles` config in `package.json` to support multiple named roles with CLI functions:

```jsonc
{
  "once": {
    "aws": {
      "roles": {
        "dev": "connect-development-admin",
        "staging": "connect-staging-admin",
        "prod": "connect-production-readonly",
      },
    },
  },
}
```

- ~~`dev assumeRole` with multiple roles prompts or takes `--env`.~~ Done — `assumeRole` and `codeArtifactAuthorise` now default to `once.aws.roles` and support `--env`.
- `dev synth --env staging` assumes the staging role. (Already implemented.)
- Functions to add/remove roles from `package.json` via the CLI.
