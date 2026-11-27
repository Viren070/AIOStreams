# AGENTS.md

JJstreams' fork of [Viren070/AIOStreams](https://github.com/Viren070/AIOStreams),
carrying JJstreams-specific changes on top of upstream. The fork is **public**,
so everything written into its history — commit authors, branch names, commit
messages — is public too.

`CLAUDE.md` is upstream's file and describes the project itself. This file is
fork-only and describes how to work *in the fork*.

## Commit identity

Every commit here is authored and committed by the shared `jjstreams` account.
A maintainer's personal account must never appear in this repository: the author
line publishes their name and address, and it subscribes them as a participant
on every pull request that carries the commit.

Git config is not part of the repository and a fresh clone inherits whatever
identity the machine has globally, so pin it per clone, before the first commit:

```sh
git config user.name jjstreams
git config user.email 339098993+jjstreams@users.noreply.github.com
```

Verify rather than assume — `git config user.email` — and do it again after
re-cloning or after `git submodule update`, which both drop local config.

Pushing goes through the same account (`gh auth switch --user jjstreams`). The
account that pushes is independent of the identity recorded inside the commit,
so both need checking: a push as `jjstreams` still publishes a personal author
line if the local config was wrong.

Before every push or PR operation, verify `gh api user --jq .login` returns
`jjstreams`. Stop if it names another account. For commands that must retain
their identity while other repositories use GitHub CLI, scope `GH_TOKEN` to
that command using `gh auth token --hostname github.com --user jjstreams`;
never print or save that token. Account switching is global to GitHub CLI,
not local to this checkout.

If the wrong identity is already in a commit that has not been pushed, rewrite
it: `git commit --amend --reset-author --no-edit`. Once it is pushed, the name
stays visible in the pull request and its timeline even after a force-push, and
only deleting and recreating the repository removes it completely.

## Branch names

Branch names are public as well, so they carry no personal initials or names.
Describe the change instead, for example `add-safe-playback-logging`.

## Pull requests

The base is always this fork's own `main`. Inside a fork, `gh pr create`
defaults to the upstream parent, which would propose JJstreams-internal changes
to `Viren070/AIOStreams`. Pin the repository explicitly:

```sh
gh pr create --repo jjstreams/AIOStreams --base main --head <branch>
```

## Fork maintenance

This fork exists to keep JJstreams logging additions on top of upstream. It does
not publish upstream's Docker images, client applications, documentation or
releases. Keep only `build.yml` and `fork-maintenance.yml` enabled in GitHub
Actions. The maintenance workflow also disables inherited publication workflows.

`fork-maintenance.yml` checks upstream `main` every hour. It makes a normal merge
in an isolated checkout, runs the admission logging tests and the addon build,
and publishes the validated merge with a normal, non-forced push. A conflict,
failed check or concurrent update stops the run and leaves remote `main` alone.
Direct pushes to `main` also run the logging tests and build. No deployment is
performed; the setup repository continues to own reviewed source pins.

The publish job uses `JJSTREAMS_UPSTREAM_SYNC_TOKEN`, the shared account's
credential, and verifies that it authenticates as `jjstreams`. This secret is
available only in the publish step, on a separate runner from upstream code
execution. Never print it or add it to Git history. Scheduled failure email
notifications belong to the account that created or last changed the schedule;
keep Actions email notifications enabled for failed runs on `jjstreams`.

Use this workflow for upstream updates rather than an additional external job
that pushes merges without these checks.
