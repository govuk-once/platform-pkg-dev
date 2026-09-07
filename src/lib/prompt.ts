import { createInterface, type Interface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { bold, dim, fail } from './log.js';

let rl: Interface | undefined;

function readline(): Interface {
  rl ??= createInterface({ input: stdin, output: stdout });
  return rl;
}

/** Closes the shared readline interface so the process can exit cleanly. */
export function closePrompts(): void {
  rl?.close();
  rl = undefined;
}

function requireInteractive(question: string, flag: string): never {
  fail(
    `Cannot prompt for "${question}" - stdin is not a TTY.`,
    `Pass ${flag} explicitly, or run platform-pkg-dev from an interactive terminal.`,
  );
}

/**
 * Asks a free-text question. `flag` names the CLI flag that supplies the same
 * value, so non-interactive runs get a useful error rather than a hang.
 */
export async function ask(
  question: string,
  options: {
    defaultValue?: string;
    flag: string;
    validate?: (value: string) => string | undefined;
  },
): Promise<string> {
  if (!stdin.isTTY) requireInteractive(question, options.flag);

  const suffix = options.defaultValue === undefined ? '' : dim(` (${options.defaultValue})`);

  for (;;) {
    const raw = await readline().question(`${bold('?')} ${question}${suffix} `);
    const value = raw.trim() === '' ? (options.defaultValue ?? '') : raw.trim();

    if (value === '') continue;

    const problem = options.validate?.(value);
    if (problem === undefined) return value;

    stdout.write(`  ${dim(problem)}\n`);
  }
}

/** Asks a yes/no question. */
export async function confirm(
  question: string,
  options: { defaultValue: boolean; flag: string },
): Promise<boolean> {
  if (!stdin.isTTY) requireInteractive(question, options.flag);

  const suffix = dim(options.defaultValue ? ' (Y/n)' : ' (y/N)');

  for (;;) {
    const raw = (await readline().question(`${bold('?')} ${question}${suffix} `))
      .trim()
      .toLowerCase();

    if (raw === '') return options.defaultValue;
    if (raw === 'y' || raw === 'yes') return true;
    if (raw === 'n' || raw === 'no') return false;

    stdout.write(`  ${dim('Please answer y or n.')}\n`);
  }
}
