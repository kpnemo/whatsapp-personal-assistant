# `scripts/wpa/_test/` — bats tests for `/wpa:*` shell helpers

This directory holds [Bats](https://bats-core.readthedocs.io/) tests that cover
the shell libraries in `scripts/wpa/_lib/` (used by the `/wpa:*` slash
commands). Each `_lib/<name>.sh` has a matching `_test/<name>.bats`.

## Running

```bash
bash scripts/wpa/_test/run.sh
```

`run.sh` delegates to the workspace-local Bats binary
(`node_modules/.bin/bats`), installed via `pnpm install` (declared in the root
`package.json` as `bats@^1.13.0`). No global install required; no Homebrew
dance.

`run.sh` discovers all `*.bats` files in this directory (non-recursive) and
passes them to `bats --print-output-on-failure`. Exit code is `0` on success,
non-zero on any failure.

## Helpers

We vendor three upstream Bats helper libraries under `bats-helpers/`:

| Helper         | Source                                      | What it adds                                          |
| -------------- | ------------------------------------------- | ----------------------------------------------------- |
| `bats-support` | <https://github.com/bats-core/bats-support> | shared machinery for nicer `fail`/`assert` output     |
| `bats-assert`  | <https://github.com/bats-core/bats-assert>  | `assert_success`, `assert_failure N`, `assert_output` |
| `bats-file`    | <https://github.com/bats-core/bats-file>    | `assert_file_exists`, `temp_make`/`temp_del`, …       |

These are **vendored** (checked into the repo at pinned release tags) rather
than installed via `npm`, because the npm packages for them are either
abandoned (`bats-file@0.0.1-security`) or don't exist (`@bats-core/*` is not
published). Vendoring keeps the dev loop self-contained and reproducible.

To load them in a test file, do this inside `setup()`:

```bash
setup() {
  load "bats-helpers/bats-support/load"
  load "bats-helpers/bats-assert/load"
  load "bats-helpers/bats-file/load"   # only if you need file asserts
}
```

## Conventions

- **One `.bats` per `_lib/*.sh`.** Keep the filename identical (`colors.sh` →
  `colors.bats`) so the pairing is obvious.
- **`setup()` sources the library.** Don't source at the top level of the
  `.bats` file — Bats rewrites the file before running, and top-level sourcing
  doesn't compose well with `run` captures.
- **Use absolute paths.** Resolve `LIB_DIR` from `$BATS_TEST_FILENAME` so tests
  pass regardless of the caller's cwd.
- **Scratch dirs via `temp_make` / `temp_del`.** Never create files in the
  repo tree during tests.
- **Exit-code convention** mirrors `_lib/preflight.sh`:
  - `0` — ok
  - `1` — fail (abort)
  - `2` — fix available (caller may auto-remediate and retry)

## Adding a new test

1. Add `_lib/<name>.sh`.
2. Add `_test/<name>.bats` with the `setup()` boilerplate above.
3. Write tests **first** (red), implement the function in `_lib/<name>.sh`
   (green), then refactor. See `scripts/wpa/_test/preflight.bats` for the
   pattern.
4. Run `bash scripts/wpa/_test/run.sh` — all tests across every `.bats` file
   must pass before committing.

## CI

`scripts/wpa/_test/run.sh` is expected to run in the same CI job as
`pnpm test`. A later Epic (H4 / CI polish) will wire this up.
