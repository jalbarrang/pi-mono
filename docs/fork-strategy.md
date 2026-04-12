# Fork Strategy

## Overview

This repository is a **downstream fork**. It intentionally and permanently diverges from upstream. The goal is not to stay close to upstream, but to maintain our own derivative while still being able to selectively consume upstream improvements when they are worth porting.

## Branch Roles

| Branch | Role | Rule |
|--------|------|------|
| `main` | Upstream mirror | Never commit here. Fast-forward only from upstream. |
| `master` | Our downstream product branch | All development, releases, and custom changes live here. |

## Remote Setup

```bash
git remote add upstream <upstream-url>
git remote -v
# origin    <your-fork-url> (fetch)
# upstream  <upstream-url>  (fetch)
```

## Syncing `main` with Upstream

`main` is a read-only vendor snapshot. Keep it updated periodically:

```bash
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
```

Never commit directly to `main`. If `--ff-only` fails, something is wrong.

## Daily Development on `master`

All work happens on `master` or on feature branches that target `master`.

```bash
git switch master
git switch -c feature/my-thing   # branch off master
# ... work ...
git switch master
git merge feature/my-thing
```

## Pulling Changes from Upstream into `master`

Since `master` is intentionally divergent, upstream changes are **optional inputs**, not mandatory absorptions.

### Cherry-pick (preferred for isolated fixes)

Use this for small, self-contained upstream changes:

```bash
git fetch upstream
git log upstream/main --oneline   # find the commit
git switch master
git cherry-pick <commit-sha>
```

### Manual port

Use this when an upstream change is conceptually useful but needs adaptation to fit our codebase. Do not cherry-pick; read the diff and reimplement it in a way that fits `master`.

### Integration branch (for larger upstream syncs)

Use this when you want to absorb a batch of upstream changes and need a safe review point before committing to `master`:

```bash
git switch master
git switch -c sync/upstream-YYYY-MM
git merge main
# resolve conflicts, test, review
git switch master
git merge sync/upstream-YYYY-MM
git branch -d sync/upstream-YYYY-MM
```

## Decision Guide: What to Pull from Upstream

| Upstream change | Recommended approach |
|----------------|----------------------|
| Bug fix, isolated and clean | `cherry-pick` |
| Feature we want but it needs adaptation | Manual port |
| Large refactor we want most of | Integration branch |
| Breaking change we disagree with | Ignore it |
| Anything that conflicts with our design | Skip or manual port |

## Contributing Back to Upstream

If a change on `master` is generic enough to benefit upstream, isolate it into a branch based off `main`, not `master`:

```bash
git fetch upstream
git switch main
git switch -c contrib/fix-thing
# cherry-pick or manually apply just that change
git push origin contrib/fix-thing
# open a PR against upstream from this branch
```

This keeps the contribution clean and free of our downstream changes.

## GitHub Setup

- Default branch: `master`
- `main` is kept as a reference/sync branch only
- Feature branches target `master`
- `main` should ideally be branch-protected to prevent accidental commits

## Key Principles

- `main` is vendor code. Treat it like a read-only dependency.
- `master` is our product. It evolves independently.
- Upstream changes are evaluated, not blindly merged.
- Breaking changes in our fork are acceptable and expected.
- When in doubt about a large upstream sync, use an integration branch instead of merging directly.
