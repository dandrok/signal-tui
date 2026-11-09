# Releasing

Publishing is **tokenless** once the first version exists. npm's trusted
publishing (OIDC) cannot create a package, so version `0.0.1` needs one
interactive publish; everything after that runs from the workflow with no stored
secret and no 2FA prompt.

## One-time bootstrap (first version only)

On your machine, in the repo:

```sh
bun run verify
bun pm pack --dry-run     # check what goes into the tarball
npm login                 # browser + 2FA, once
npm publish --access public
```

Then, on npmjs.com → `signal-tui` → **Settings → Trusted Publisher**:

| Field | Value |
|---|---|
| Organization or user | `dandrok` |
| Repository | `signal-tui` |
| Workflow filename | `release.yml` |
| Environment name | `npm-publish` |
| Allowed actions | tick **`npm publish`** (staged publish is always allowed) |

The environment field matters: the workflow publishes inside the `npm-publish`
environment, and binding it here is what stops an edited branch workflow from
publishing under the same identity. In GitHub → Settings → **Environments**,
create `npm-publish` and add a deployment branch rule allowing only `main`.

Finally delete the `NPM_TOKEN` repository secret if one was created — from here on
the workflow authenticates through OIDC and generates provenance.

## Which number?

This is an application, not a library: the "consumer" is a user and their machine, so *breaking*
means their install, config, cache or keymap stops working — not that an import broke.

| | Means | Examples from this repo |
|---|---|---|
| **patch** `0.2.1` | fixes only; nothing new to learn, nothing to change | the reaction stale-ref fix on its own · hidden rows leaking into FTS search · README/CHANGELOG corrections · an internal refactor with no visible change |
| **minor** `0.2.0` | new capability; nothing existing is invalidated | edit · delete-for-everyone · hide-locally · the reaction picker · taking a reaction back |
| **major** `1.0.0` | a user **has to change something** | cache schema changed without a migration (their history is gone) · CLI flags renamed or removed · engine requirement raised incompatibly · config format rewritten so existing files are invalid |

Two rules that keep this honest:

- **Nothing breaks inside `0.x`.** Strict semver allows a breaking change in a `0.x` minor; we are
  stricter than the spec here, so the only way to break a user is to say `1.0.0` — deliberately.
  The release bot is configured to match: a `!` or `BREAKING CHANGE:` commit bumps the minor while
  the major is 0. To spend `1.0.0`, push an empty commit to `main` with `Release-As: 1.0.0` in its
  body — the bot reads that footer and opens the PR for exactly that number. Editing the version
  in the release PR does not survive: the bot rewrites its own branch on the next push.
- **`1.0.0` is a promise, not a feature count.** It means flags, keys and the cache schema are
  stable, and breaking them costs a `2.0.0`. Not "we ran out of features".

## Every release after that

Nobody types the version. `release-please.yml` reads the conventional commits on `main` and
keeps one PR open holding the next number in `package.json` plus a first draft of the CHANGELOG
section.

1. **A release PR appears** once a `feat` or `fix` has landed since the last tag. Commits that
   ship nothing — `chore`, `docs`, `test`, `ci` — never spend a number, so a docs pass opens no PR.
   It carries no CI checks, because a PR opened with the repository's `GITHUB_TOKEN` does not
   start workflows; the gate that matters runs in the publish job, on the tag, before `npm publish`.
2. **Read the draft.** The section is generated from commit subjects, one line each: a draft, not
   the release note this project writes. Rewrite it in the PR — the prose above each `## [x.y.z]`
   header says more than the bullets do, and the PR is where that happens.
3. **Merge it.** That is the release decision: the bot tags the merge commit `vX.Y.Z`, opens the
   GitHub release, and calls the publish workflow in the same run (called rather than triggered —
   a release made with `GITHUB_TOKEN` cannot start a workflow of its own).
4. **The workflow publishes**: `bun run verify`, `bun pm pack --dry-run`, then
   `npm publish --provenance`. It checks out the tag rather than `main`, so the tarball is the
   tagged commit and `npm view signal-tui@<version> gitHead` equals `v<version>` — the tag cannot
   drift from what was published, which is what tagging by hand after the fact used to risk.

### When a release fails after the merge

The merge has already moved `.release-please-manifest.json` to the new number, so nothing about
deleting a tag puts that number back in play — the next proposal will be the following one.

| What is wrong | What to do |
|---|---|
| the tag is right, `npm publish` never ran | re-create the release on the same existing tag (GitHub → Releases → *Draft a new release* → pick `vX.Y.Z` from the tag list). That fires `release: published` and publishes the tag that is already there. |
| the tagged commit is wrong | delete the release and the tag (`git push origin :vX.Y.Z`). The number in the manifest is spent: bump it back in a PR of its own, or accept the next number, and let the bot propose again. |
| `npm publish` succeeded and the code is wrong | the table under *If a release is wrong* below — the number is spent for good. |

### Two one-time clicks

- GitHub → Settings → **Actions** → *General* → **Workflow permissions**: tick **Allow GitHub
  Actions to create and approve pull requests**. Without it the bot cannot open its PR and the
  run fails with `Resource not accessible by integration`, which reads like a broken workflow
  rather than a missing setting.
- A **tag** rule matching `v*` on the `npm-publish` environment is needed only for the by-hand
  path (a release created in the UI publishes on a tag ref); the normal path calls the workflow
  from `main` and is judged as a branch deployment. Add the rule if a manual release stops on the
  environment.

### Proving the publish path without spending a number

Actions → **release** → *Run workflow* on `main` with `dry_run: true`: install, `bun run verify`,
`bun pm pack --dry-run`, and stop before `npm publish`. It proves the dependency install, the
gate, the tarball contents, and that the environment admits a run from `main`. It does **not**
exercise a tag rule, and it does not exercise trusted publishing — no `npm publish` happens, so
OIDC is never asked for a credential. Those two are proved by the first real release.

## If a release is wrong

| When | What to do |
|---|---|
| within 72 h, **and** nothing depends on the package | `npm unpublish signal-tui@<version>` |
| later, **and** nothing depends on it, < 300 weekly downloads, single owner | unpublish is still permitted |
| otherwise | `npm deprecate signal-tui@<version> "reason"`, then publish a fixed version |
| workflow failed halfway | nothing was published unless `npm publish` succeeded; fix and re-run |

Two hard rules from npm's policy: a version number can never be reused, and
unpublishing all versions blocks the name for 24 hours.

## Notes

- Trusted publishing requires npm **>= 11.5.1** and node **>= 22.14**; the workflow
  upgrades npm itself because the runner's bundled copy is older.
- 2FA-bypass tokens lose the ability to publish directly around **January 2027**,
  which is the other reason this repo uses OIDC rather than a stored token.
- npm 12 stopped running dependency lifecycle scripts by default; this package has
  none, so installing it needs no `allowScripts` entry.
