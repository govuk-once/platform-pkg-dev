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

/** Asks the user to pick one or more options from a numbered list. Accepts `1`, `1,2`, `1 & 2`, or `all`. */
export async function choose<T extends string>(
  question: string,
  options: { choices: readonly { label: string; value: T }[]; flag: string },
): Promise<T[]> {
  if (!stdin.isTTY) requireInteractive(question, options.flag);

  const n = options.choices.length;
  stdout.write(`${bold('?')} ${question}\n`);
  for (let i = 0; i < n; i++) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const choice = options.choices[i]!;
    stdout.write(`  ${bold(String(i + 1))} ${choice.label}\n`);
  }

  stdout.write(`  ${dim(`Enter 1-${n}, e.g. 1, 1 & 2, or all`)}\n`);

  for (;;) {
    const raw = (await readline().question(`${dim('  Choice:')} `)).trim().toLowerCase();

    if (raw === 'all') {
      return options.choices.map((c) => c.value);
    }

    const nums = raw
      .split(/[\s,&]+/)
      .map(Number)
      .filter((v) => Number.isInteger(v) && v >= 1 && v <= n);

    if (nums.length > 0) {
      // oxlint-disable-next-line typescript/no-non-null-assertion
      return [...new Set(nums)].map((i) => options.choices[i - 1]!.value);
    }

    stdout.write(`  ${dim(`Enter 1-${n}, e.g. 1, 1 & 2, or all.`)}\n`);
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
