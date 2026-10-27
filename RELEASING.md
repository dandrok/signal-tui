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
- **`1.0.0` is a promise, not a feature count.** It means flags, keys and the cache schema are
  stable, and breaking them costs a `2.0.0`. Not "we ran out of features".

## Every release after that

1. Bump `version` in `package.json` (the binary reads it, so they cannot drift).
2. Open a PR, merge it.
3. Actions → **release** → *Run workflow* with `dry_run` set to **true** — install, `bun run verify`
   and `bun pm pack --dry-run`, without publishing. It proves the environment and OIDC still
   work *before* the version number is spent, and a number cannot be reused.
4. Run it again with `dry_run: false`.

The workflow runs `bun run verify`, checks the packed contents, then
`npm publish --provenance`. Provenance links the published tarball to this commit
and workflow run.

5. **Tag the published commit, not `main`.** By the time you tag, `main` may have moved; the
   authority is `gitHead` on the published version:

   ```sh
   npm view signal-tui@<version> gitHead     # the commit npm built the tarball from
   git tag -a v<version> <that-sha> -m "<version>"
   git push origin v<version>
   ```

   A tag on a later commit claims something npm did not publish, and the release notes and
   provenance both hang off this tag.

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
