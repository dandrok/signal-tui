# signal-tui

A terminal Signal client. Ink + Bun, local-first, with full-text search over your history.

**Status: `0.0.x` — skeleton.** Phase 0 renders a real TUI over an in-memory store. No
network, no linking, no crypto yet.

## Requirements

- [Bun](https://bun.sh/docs/installation) **1.4+** — required at runtime, not just for development

## Quick start

```sh
bun install
bun run setup   # enables the tracked git hooks (.githooks)
bun start
```

Keys: `j`/`k` move · `i` or `Enter` compose · `Esc` back · `q` quit.

## Scripts

| Script | What it does |
|---|---|
| `bun start` | run the TUI |
| `bun test` | unit + ink render tests |
| `bun run typecheck` | `bun check` — Bun's native multi-core TypeScript check |
| `bun run lint` | Biome: lint, format, import layering |
| `bun run verify` | all three, the same gate CI runs |
| `bun run setup` | `git config core.hooksPath .githooks` |

## Architecture

Ports and adapters, so nothing outside `src/ui` knows about the terminal and nothing inside
`src/domain` knows about IO.

```
src/
  domain/     pure types + formatting helpers        (no imports outside domain)
  ports/      MessageStore, SignalBackend interfaces
  adapters/   memory/ (tests, demo) · sqlite/ + signal/ (next)
  app/        reducer: every transition is a pure function
  ui/         ink components + hooks                 (no adapter imports)
  cli.tsx     composition root: wires adapters into App
```

Import boundaries are enforced in `biome.json` via `noRestrictedImports` — CI fails if
`domain` reaches for `ink` or `ui` imports an adapter.

## Code review

Two layers, both free on public repos:

```sh
# local, before pushing (CodeRabbit CLI)
cr auth status          # or: cr auth login
cr review --deep        # full PR-policy review of your local changes
cr review --agent       # NDJSON findings, if you want them machine-readable
```

On GitHub, CodeRabbit's app reviews every PR automatically; `.coderabbit.yaml` carries the
repo rules (layer boundaries, "tests must assert behaviour", lockfile excluded). Ask for a
whole-repo pass with `@coderabbitai full review` in a PR comment.

## Roadmap

| Phase | Scope |
|---|---|
| 0 | skeleton: ink app, reducer, memory store, CI, hooks ← **here** |
| 1 | `signal-cli` JSON-RPC adapter, typed from the official 43 JSON schemas |
| 2 | SQLite cache + FTS5 search, instant open |
| 3 | attachments, groups, reactions, edits, receipts |
| 4 | voice calls via signal-cli's RingRTC tunnel |
| 5 | npm release with trusted publishing |

Notes and design decisions live in the Obsidian vault (`BUILD/signal-tui/`).
