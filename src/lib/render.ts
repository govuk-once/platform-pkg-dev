import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to the templates directory shipped alongside dist/. */
export const TEMPLATES_ROOT = fileURLToPath(new URL('../../templates/', import.meta.url));

export type TemplateVars = Readonly<Record<string, string>>;

/**
 * Substitutes `{{name}}` placeholders. An unknown placeholder is a template
 * bug, not a runtime condition, so it throws rather than rendering literally.
 */
export function substitute(content: string, vars: TemplateVars): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new Error(`Template referenced unknown variable "${key}"`);
    return value;
  });
}

/**
 * Template files are stored with a leading underscore instead of a dot, because
 * npm strips `.gitignore` from published tarballs and would silently drop them.
 */
export function targetName(name: string): string {
  return name.startsWith('_') ? `.${name.slice(1)}` : name;
}

/**
 * Template files that seed a package rather than being managed by platform-pkg-dev.
 *
 * Once written they belong to the package, so `--force` must not overwrite
 * them: re-scaffolding to pick up a config change should never destroy
 * someone's source or their README.
 */
export function isSeedFile(relativePath: string): boolean {
  const posix = relativePath.split(sep).join('/');
  return posix === 'README.md' || posix.startsWith('src/');
}

export interface WriteReport {
  readonly written: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Lists the paths a template directory would write, without writing anything.
 *
 * Used by `init` to warn about overwrites before touching the disk, rather than
 * reporting them after the damage is done.
 */
export async function planTemplateDir(
  templateDir: string,
  destDir: string,
): Promise<readonly string[]> {
  const planned: string[] = [];

  const walk = async (from: string, to: string): Promise<void> => {
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const source = join(from, entry.name);
      const destination = join(to, targetName(entry.name));

      if (entry.isDirectory()) await walk(source, destination);
      else planned.push(relative(destDir, destination));
    }
  };

  await walk(join(TEMPLATES_ROOT, templateDir), destDir);
  return planned;
}

/**
 * Copies one template directory into `destDir`, substituting variables.
 *
 * Existing files are left alone unless `force` is set; every decision is
 * reported so init can print an accurate summary.
 */
export async function renderTemplateDir(
  templateDir: string,
  destDir: string,
  vars: TemplateVars,
  options: { force: boolean; skip?: readonly string[] },
): Promise<WriteReport> {
  const written: string[] = [];
  const skipped: string[] = [];

  const walk = async (from: string, to: string): Promise<void> => {
    for (const entry of await readdir(from, { withFileTypes: true })) {
      const source = join(from, entry.name);
      const destination = join(to, targetName(entry.name));

      if (entry.isDirectory()) {
        await walk(source, destination);
        continue;
      }

      const report = relative(destDir, destination);

      if (options.skip?.includes(report) === true) continue;

      if (existsSync(destination) && (!options.force || isSeedFile(report))) {
        skipped.push(report);
        continue;
      }

      const content = substitute(await readFile(source, 'utf8'), vars);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content, 'utf8');

      // Git hook scripts are useless unless they stay executable, so the
      // template's mode is carried across rather than defaulted.
      await chmod(destination, (await stat(source)).mode & 0o777);
      written.push(report);
    }
  };

  await walk(join(TEMPLATES_ROOT, templateDir), destDir);

  return { written, skipped };
}

/** Writes a generated (non-template) file, honouring the same overwrite rules. */
export async function writeGenerated(
  destDir: string,
  name: string,
  content: string,
  options: { force: boolean; skip?: readonly string[] },
): Promise<WriteReport> {
  const destination = join(destDir, name);

  if (existsSync(destination) && !options.force) {
    return { written: [], skipped: [name] };
  }

  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, 'utf8');
  return { written: [name], skipped: [] };
}

export function mergeReports(reports: readonly WriteReport[]): WriteReport {
  return {
    written: reports.flatMap((report) => report.written),
    skipped: reports.flatMap((report) => report.skipped),
  };
}
