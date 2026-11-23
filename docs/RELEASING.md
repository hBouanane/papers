# Releasing Papers

People install Papers with `uvx papers-app`, `uv tool install papers-app`, `pipx` or Docker, and keep their
library on their own computer. A release reaches all of them, so releases are planned rather than made after every
pull request.

## Versions

`MAJOR.MINOR.PATCH`, following [semantic versioning](https://semver.org); while Papers is 0.x:

- **Minor** (`0.6.0`): new features and changes. Libraries made by earlier versions keep working, always.
- **Patch** (`0.6.1`): fixes only, nothing new.
- **Release candidate** (`0.6.0rc1`): a minor version to try before it's final. `pip`, `pipx` and `uv` don't install it
  unless asked (`uvx papers-app==0.6.0rc1`), and it doesn't become Docker's `latest`.

## When

- **Work goes to `main`, not straight to people.** Each pull request adds its lines under `## Unreleased` in
  `CHANGELOG.md`; merging one doesn't release anything.
- **A minor release when a set of changes is done and tried**: about every two weeks, or when something people are
  waiting for is ready. Not after each pull request.
- **A patch release only when people are stuck**: Papers won't install, won't start or won't open a library; data
  can be lost or damaged; or a security problem. Those go out the same day. Other bugs wait for the next minor.
- **At most one release a day**, unless the one before broke something.

## Before a minor release

1. **`main` is green**, including the `installed` check: the package built, installed in a clean environment and
   started the way people start it (without a console, like the desktop icon) on Windows, macOS and Linux.
2. **A release candidate**: bump `__version__` to `X.Y.0rc1`, tag `vX.Y.0rc1`. It's published, but nobody gets it
   by accident.
3. **Use it for a day on a real library**, ideally on two systems:
   - `uv tool install --prerelease allow papers-app==X.Y.0rc1` (or `uvx papers-app==X.Y.0rc1`)
   - open an existing library made by the previous version: papers, notes, highlights, guides still there
   - the first-run setup in a fresh folder (`papers --data <empty folder>`), the desktop icon, closing the window
   - one paper end to end: add, read, ask, the overview and the guide
4. **Problems found**: fix them on `main`, then `rc2`. None: the final release.

A patch release skips 2 and 3, but not 1, and the fix comes with a test that fails without it.

## Making the release

1. A pull request named `Release X.Y.Z`: `__version__` in `papers/__init__.py`, and `## Unreleased` in
   `CHANGELOG.md` renamed `## X.Y.Z`. The changelog says what changes for the person reading, in plain words.
2. Merge it once CI is green, then tag the merge: `git tag -a vX.Y.Z -m "Papers X.Y.Z"` and push the tag.
3. The `Release` workflow publishes to PyPI and the Docker image to `ghcr.io`. Make the GitHub release from the tag
   with that version's changelog as its notes (marked pre-release for an `rc`).
4. Check: `https://pypi.org/project/papers-app/X.Y.Z/` exists, and `uvx --refresh papers-app --version` says `X.Y.Z`.

## After

- For a day or two, watch for reports. Someone stuck means a patch release (see above).
- Tell people what to run to upgrade: `uv tool upgrade papers-app`, `pipx upgrade papers-app`, or
  `uvx --refresh papers-app`. Their library and desktop icon keep working.
