#!/bin/sh
# Bootstrap a Once package.
#
#   curl -fsSL https://raw.githubusercontent.com/govuk-once/platform-pkg-dev/main/start.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/govuk-once/platform-pkg-dev/main/start.sh | sh -s -- --dir once-foo --name once-foo --team identity
#
# --dir names a folder to create and work in. Without it, an empty directory is
# used as-is and a non-empty one prompts, so piping this into the wrong place
# cannot quietly scatter files over an existing project.
#
# `dev init` cannot be the first step: it lives in platform-pkg-dev, which is
# not installed until a package.json exists that depends on it. This writes a
# minimal manifest, installs, and then hands over to `dev init`, which
# overwrites that manifest with the real one.
#
# Versions here are checked against platform-pkg-dev's versions.json by its test suite,
# so this file cannot drift from the pins.
set -eu

# Overridable from the environment so the script can be exercised against a
# local checkout before platform-pkg-dev is published. The defaults are the real pins,
# and platform-pkg-dev's test suite checks them against versions.json.
NODE_MAJOR=${NODE_MAJOR:-24}
PNPM=${PNPM:-pnpm@11.25.0}
PKG_DEV=${PKG_DEV:-^0.0.1}

fail() { echo "platform-pkg-dev: $1" >&2; exit 1; }

# `[ -r /dev/tty ]` is not enough: the device can exist but be unusable, for
# example under CI or a detached shell, where writing to it aborts the script.
has_tty() { { true > /dev/tty; } 2>/dev/null; }

# `start.sh local` resolves platform-pkg-dev from a sibling checkout instead of
# the registry.  Strip the keyword before normal arg parsing begins.
if [ "${1:-}" = "local" ]; then
  PKG_DEV="link:../platform-pkg-dev"
  shift
fi

# Pull --dir out of the arguments; everything else is forwarded to `dev init`.
# The marker keeps quoting intact while rebuilding "$@" in POSIX sh.
DIR=""
set -- "$@" "--end-of-args--"
while [ "$1" != "--end-of-args--" ]; do
  case "$1" in
    --dir) shift; [ "$1" != "--end-of-args--" ] || fail "--dir needs a folder name."; DIR="$1" ;;
    --dir=*) DIR="${1#--dir=}" ;;
    *) set -- "$@" "$1" ;;
  esac
  shift
done
shift

if [ -z "$DIR" ]; then
  # .git alone still counts as empty: `git init` before bootstrapping is normal.
  if [ -z "$(ls -A . 2>/dev/null | grep -v '^\.git$' || true)" ]; then
    DIR="."
  elif has_tty; then
    echo "platform-pkg-dev: $(pwd) is not empty." >&2
    printf 'Folder to create, or press enter to use this directory: ' > /dev/tty
    read -r DIR < /dev/tty
    [ -n "$DIR" ] || DIR="."
  else
    fail "$(pwd) is not empty, and there is no terminal to ask.
  Pass --dir <folder>, or run this in an empty directory."
  fi
fi

if [ "$DIR" != "." ]; then
  [ -e "$DIR" ] && [ ! -d "$DIR" ] && fail "$DIR exists and is not a directory."
  mkdir -p "$DIR"
  cd "$DIR"
  echo "platform-pkg-dev: working in $(pwd)"
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "platform-pkg-dev: initialising git repository"
  git init
fi

command -v node >/dev/null 2>&1 || fail "node is not installed. Install Node ${NODE_MAJOR}, then re-run."

major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge "$NODE_MAJOR" ] || fail "Node ${NODE_MAJOR}+ required, found $(node -v)."

# corepack reads packageManager from package.json, so the manifest has to exist
# before pnpm is invoked - otherwise corepack picks its own default version and
# then refuses to switch.
if [ -f package.json ]; then
  echo "platform-pkg-dev: package.json already exists, leaving it alone."
else
  echo "platform-pkg-dev: writing a temporary package.json (dev init replaces it)"
  cat > package.json <<JSON
{
  "name": "dev-bootstrap",
  "private": true,
  "packageManager": "${PNPM}",
  "devDependencies": { "platform-pkg-dev": "${PKG_DEV}" },
  "once": { "bootstrap": true }
}
JSON
fi

if command -v corepack >/dev/null 2>&1; then
  corepack enable pnpm >/dev/null 2>&1 || true
fi

command -v pnpm >/dev/null 2>&1 || fail "pnpm is not available. Run 'corepack enable pnpm', then re-run."

want=${PNPM#pnpm@}
have=$(pnpm --version 2>/dev/null || echo unknown)
if [ "$have" != "$want" ]; then
  fail "pnpm ${want} is pinned but ${have} is running.
  corepack prepare ${PNPM} --activate"
fi

echo "platform-pkg-dev: installing (pnpm ${have})"
pnpm install || fail "pnpm install failed.
  If platform-pkg-dev is not published yet, point at a local checkout instead:
    pnpm add -D platform-pkg-dev@link:/path/to/platform-pkg-dev && pnpm dev init"

# --pkg-dev first so an explicit one from the caller still wins: the spec init
# records must match the one actually installed above, or the next install
# fetches a different platform-pkg-dev than the one that just ran.
echo "platform-pkg-dev: running dev init"
pnpm dev init --pkg-dev "$PKG_DEV" "$@"

# init rewrites package.json with the package's real dependency set - oxlint,
# oxfmt, the type-aware engine - so the first install only ever got platform-pkg-dev.
echo "platform-pkg-dev: installing the package's dependencies"
pnpm install

echo "platform-pkg-dev: wiring git hooks"
pnpm dev hooks install

echo "platform-pkg-dev: done."
