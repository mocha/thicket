# Contributing to thicket

thicket is developed on a private forge and published to
[github.com/mocha/thicket](https://github.com/mocha/thicket) at each release.
GitHub's `main` is therefore the latest release, not the latest commit.

**From GitHub:** issues and pull requests are welcome. A pull request is
carried into development by hand and arrives on GitHub with the next release.

The rest of this file is for maintainers.

## Day to day

- Code lives on Forge (`deuley/thicket`); work is tracked in Plane (project
  THICKET). Branch from `main`, name the branch after the work item
  (`thicket-43-forge`), and open the pull request on Forge.
- The `Migration integrity` check runs on every pull request. Existing
  migration SQL in `packages/api/drizzle/` is immutable; add a new migration.
- **Merging to `main` deploys readthicket.com.** The `Deploy` workflow runs
  `railway up` against the Railway service `thicket`, and Railway builds the
  Dockerfile.

## Cutting a release

A release publishes `main` as of a tag to GitHub. Releases are manual and
infrequent: cut one when the code has reached a point worth showing, not on
every merge.

1. Pick the version. Before 1.0, bump the minor version for a release with
   anything notable (`0.1.0` → `0.2.0`) and the patch version for fixes only.
2. Set `"version"` in the root `package.json` to it, in a pull request
   merged to `main` like any other change. Skip this when the version is
   already right, as it was for `0.1.0`.
3. Tag the merged commit and push the tag to Forge:

   ```sh
   git fetch origin
   git tag -a v0.2.0 -m "thicket 0.2.0" origin/main
   git push origin v0.2.0
   ```

4. The `Release` workflow checks that the tag matches `package.json` and is
   on `main`, then pushes that commit to GitHub's `main` along with the tag.
   Watch it in the Forge Actions tab.

To publish an existing tag again (say, after fixing a secret), run the
`Release` workflow by hand from the Actions tab and give it the tag.

**If the push to GitHub is rejected,** GitHub's `main` has commits that Forge
doesn't, usually a pull request merged on GitHub by mistake. Bring those
commits into Forge's `main` (or decide to drop them) and run the release
again. Never force-push GitHub.

No container image is published yet; the source on GitHub is the release.

## Pipeline setup

The workflows are in `.forgejo/workflows/`. They need two repository secrets
on Forge:

| Secret | What it is |
|---|---|
| `RAILWAY_TOKEN` | A Railway project token for the Thicket project, production environment |
| `GH_MIRROR_DEPLOY_KEY` | The private half of a deploy key with write access on `mocha/thicket` |

The Railway service must not have a GitHub source connected. With one
connected, a release pushed to GitHub would redeploy that older commit over
production.

`.github/workflows/` stays for pull requests opened on the GitHub mirror.
Forgejo ignores it because `.forgejo/workflows/` exists.
