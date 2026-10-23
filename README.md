# signal-tui

A terminal Signal client. Ink + Bun, local-first, with full-text search over your history.

**Status: `0.0.x` — usable, early.** The TUI runs in demo mode on built-in data, or in
live mode against a linked Signal account. Message content, keys and history stay on
your machine; the TUI itself never talks to the network — it drives `signal-cli` over
JSON-RPC on stdio.

## Requirements

- [Bun](https://bun.sh/docs/installation) **1.4.4+** — required at runtime, not just for development
- [signal-cli](https://github.com/AsamK/signal-cli) **0.14+** — only for live mode; the
  GraalVM native build needs no Java
- `qrencode` — only for `bun run link`, to draw the linking QR as an image

## Quick start

```sh
bun install
bun run setup   # enables the tracked git hooks (.githooks)
bun start       # demo mode, no account needed
```

Keys: `j`/`k` move · `i` or `Enter` compose · `Esc` back · `q` quit.

### Live mode

```sh
bun run link                                  # QR image → scan with Signal → Linked devices
signal-cli listAccounts                       # prints your number
bun run src/cli.tsx --account +48123456789    # cache: ~/.local/share/signal-tui/cache.db
```

`bun run link` exists because the QR that `signal-cli link` draws in the terminal is
unusable: the GraalVM native build ships a US-ASCII-only charset and therefore emits
literal `?` bytes instead of block glyphs (verified by hexdumping its pty output;
`-Dfile.encoding=UTF-8` does not fix it). The helper reads the `sgnl://` URI that
signal-cli prints alongside the art and renders a PNG instead.

The cache stores message bodies in plaintext, so it is created `0600` inside a `0700`
directory; `--db` refuses a directory other users can write to.

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
cr review --deep        # review your tracked local changes
cr review --agent       # NDJSON findings, if you want them machine-readable
```

On GitHub, CodeRabbit's app automatically reviews non-draft PRs targeting `main`; `.coderabbit.yaml`
carries the repo rules (layer boundaries, "tests must assert behaviour", lockfile excluded). Ask
for a full PR review from scratch with `@coderabbitai full review` in a PR comment.

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

## License

MIT — see [LICENSE](./LICENSE). Third-party JSON schemas used for type generation are fetched at
build time from [signal-cli](https://github.com/AsamK/signal-cli) (GPL-3.0) and are not vendored
into this repository.
