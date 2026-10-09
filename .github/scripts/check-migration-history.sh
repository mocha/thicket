#!/usr/bin/env bash
set -euo pipefail

: "${MIGRATION_BASE_COMMIT:?Set MIGRATION_BASE_COMMIT to the PR base commit}"
: "${MIGRATION_HEAD_COMMIT:?Set MIGRATION_HEAD_COMMIT to the PR head commit}"

# Compare the PR's changes with its merge base, so unrelated migrations added
# to main after the branch was created are not mistaken for deletions.
# Treat renames as deletion + addition: applied SQL names are immutable too.
changed=$(git diff --name-only --no-renames --diff-filter=MD \
  "$MIGRATION_BASE_COMMIT...$MIGRATION_HEAD_COMMIT" -- 'packages/api/drizzle/*.sql')
if [[ -n "$changed" ]]; then
  echo 'Existing migration SQL must not be edited, renamed, or deleted. Add a new migration instead.' >&2
  echo "$changed" >&2
  exit 1
fi
echo 'Migration integrity: existing SQL is unchanged.'
