---
name: release
description: Prepare and publish a versioned @dfosco/lanes release through the repository's GitHub Actions OIDC workflow.
metadata:
  author: Daniel Fosco
  version: "2026.11.01"
---

# Release Skill

> Triggered by: "release", "cut a release", "publish a release", "release a new version", or "ship a release".
>
> Use only for an explicitly authorized release. This skill prepares a single stable `@dfosco/lanes` package version and routes publication through `.github/workflows/publish.yml`.

## Release flow

1. Read the current package version, the latest `v*` tag, and the commits since that tag. Summarize the user-visible changes and propose a patch, minor, or major bump. Ask for the exact bump and summary when the existing request does not already specify them. Reuse a version explicitly authorized in the current task; do not ask again.
2. Run the selected command:

   ```bash
   npm run release:patch
   npm run release:minor
   npm run release:major
   ```

   Run only one. The command runs root tests and updates `package.json`, `npm-shrinkwrap.json`, and `src/version.js`. It does not create a commit or tag, push, or publish.
3. Review the version diff and `CHANGELOG.md`. Make any requested release-note edits, then run `npm run test:all`, Paseo typecheck/tests, and the relevant package checks. Commit the reviewed version change through the normal repository workflow.
4. Create the exact `vMAJOR.MINOR.PATCH` tag on the reviewed commit and push the commit and tag through the normal repository workflow. The tag must point to a commit on `main` and match the package version.
5. A tag push starts `.github/workflows/publish.yml`. To retry an existing release, explicitly dispatch `publish.yml` with `tag=vMAJOR.MINOR.PATCH`:

   ```bash
   gh workflow run publish.yml -f tag=v3.0.0
   ```

   The workflow checks out the selected tag, rejects prerelease or mismatched tags, runs root tests and package smoke checks, then installs and checks the Paseo plugin. It publishes the single root package with npm trusted publishing and provenance using GitHub OIDC. The workflow has no npm token.
6. The publish script handles registry propagation and retries. It uses fresh registry lookups and waits up to ten minutes for the version metadata, provenance, and downloadable tarball to appear. A published version must match the package identity and packed tarball integrity; the downloaded tarball bytes must also hash to that integrity. If matching version metadata exists while provenance or the tarball is still propagating, wait without publishing the version again. Fail immediately on an identity or integrity mismatch. After publication is verified, the workflow creates GitHub release notes from the exact matching version section in `CHANGELOG.md` if they do not already exist.
7. Report the tag, workflow run, npm version, and GitHub release. A successful workflow is the publication evidence.

## Guardrails

- Use one stable `@dfosco/lanes` release. Do not create changesets, prerelease channels, or per-package tags.
- Do not run `npm publish` locally. Publication uses only the exact trusted workflow filename `publish.yml` and the configured npm OIDC publisher.
- Version bump commands do not stage files, commit, tag, push, or create GitHub releases. Keep those source-control actions visible for review.
- Do not create or edit remote release notes outside the workflow unless the user explicitly directs that separate action.
- On failure, inspect the workflow logs. Retry the same tag only after resolving the cause. The idempotency check verifies the npm artifact before it skips publication.
- Do not mark a release complete based only on a tag or a workflow dispatch. Confirm the workflow succeeded and the package version is visible in the registry.
