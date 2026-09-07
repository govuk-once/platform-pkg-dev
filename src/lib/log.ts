const ESC = String.fromCharCode(27) + '[';
const RESET = String.fromCharCode(27) + '[0m';

const useColour = process.env['NO_COLOR'] === undefined && (process.stdout.isTTY ?? false);

const wrap = (code: string) => (text: string) =>
  useColour ? `${ESC}${code}m${text}${RESET}` : text;

export const bold = wrap('1');
export const dim = wrap('2');
export const red = wrap('31');
export const green = wrap('32');
export const yellow = wrap('33');
export const cyan = wrap('36');

export function info(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function step(message: string): void {
  process.stdout.write(`${cyan('>')} ${message}\n`);
}

export function ok(message: string): void {
  process.stdout.write(`${green('+')} ${message}\n`);
}

export function warn(message: string): void {
  process.stderr.write(`${yellow('!')} ${message}\n`);
}

export function error(message: string): void {
  process.stderr.write(`${red('x')} ${message}\n`);
}

/** Prints the message and exits non-zero. Never returns. */
export function fail(message: string, hint?: string): never {
  error(message);
  if (hint !== undefined) process.stderr.write(`  ${dim(hint)}\n`);
  process.exit(1);
}
