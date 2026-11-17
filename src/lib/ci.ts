/**
 * True in a pipeline. GitHub Actions and most other CI systems set `CI`;
 * `CI=false` or `CI=0` opts back out, e.g. to debug a pipeline step locally.
 *
 * Pipelines get no developer-machine steps (gds-cli role assumption, git hook
 * wiring) and no changes to versions or files: what they build is what was committed.
 */
export function isCI(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env['CI'];
  return value !== undefined && value !== '' && value !== 'false' && value !== '0';
}
