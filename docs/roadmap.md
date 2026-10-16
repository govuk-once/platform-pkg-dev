# Roadmap

## `dev init --detach`

Scaffold a fully standalone package with no ongoing sync to platform-pkg-dev. All templates, configs and hook scripts are rendered inline — no `extends` back to platform-pkg-dev's base configs, no `dev sync`, no dependency on platform-pkg-dev after init completes.

Use case: packages that need the initial scaffolding but will diverge intentionally (e.g. external contributions, packages moving out of the Connect org).

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
