# Release Process

This repo is GitHub-installable in Phase 10, but it is still **not** published to npm.

Use this release flow when you want a manual GitHub release with a verified tarball artifact.

## Versioning

- stay on pre-1.0 semver for now
- bump versions manually in `package.json` and `package-lock.json`
- use tags in the form `vX.Y.Z`
- update `CHANGELOG.md` before creating a release draft

## Local release preparation

Run the full release-prep gate locally:

```bash
npm run release:prepare
```

This does three things:

1. runs the normal verification gate
2. proves the packed tarball can be installed into a temp consumer project
3. creates a release tarball plus `tmp/release/pack-result.json`

If you only want a tarball artifact without the full gate, run:

```bash
npm run pack:tarball
```

## Manual GitHub release workflow

Use the `Release` workflow in GitHub Actions when you are ready to create or update a draft release.

Inputs:

- `ref`: the branch or tag you want to release from
- `version`: the version number without the leading `v`

The workflow will:

1. check out the selected ref
2. run `npm run release:prepare`
3. create a checksum for the packed tarball
4. upload the tarball, checksum, and manifest as workflow artifacts
5. create or update a **draft** GitHub Release for `vX.Y.Z`

## Install posture

The outside-facing public story for now is:

- the root package is the main reusable toolkit
- `./advanced` exists, but it is secondary and repo-specific
- npm publishing remains out of scope until a later decision explicitly changes it
