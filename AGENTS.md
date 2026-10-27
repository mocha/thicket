# Agent notes for thicket

Read [README.md](README.md) for what thicket is and how to run it, and
[CONTRIBUTING.md](CONTRIBUTING.md) for how work moves from a branch to
production and to a release.

## Where things live

- **Code:** Forge, `deuley/thicket` (https://forge.ronin.inc/deuley/thicket).
  Branch from and open pull requests against `main` there.
- **Issues:** Plane, project THICKET (https://plan.ronin.inc). Reference the
  work item in branch names and PR titles: `thicket-43-forge`,
  `[THICKET-43] …`. GitHub Issues are not used.
- **GitHub (`mocha/thicket`)** is the public mirror, updated only by the
  release workflow. Never push to it or merge pull requests there.

## Rules

- Never edit, rename or delete an existing migration in
  `packages/api/drizzle/`; add a new one. A PR check enforces it.
- Merging to `main` on Forge deploys readthicket.com. Treat `main` as
  production.
- Planning notes, decision records and scratch work live outside this
  repository (see `.gitignore`); everything committed here is published.
