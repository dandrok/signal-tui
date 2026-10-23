# signal-tui

A terminal Signal client. Ink + Bun, local-first: messages live in SQLite on your
machine, and the TUI never touches the network itself — it drives
[`signal-cli`](https://github.com/AsamK/signal-cli) over JSON-RPC on stdio.

**Status: `0.0.x` — usable for text conversations.** Read, send, groups, deletes,
unread counts and read receipts work against a real account.

## Requirements

| Tool | Why |
|---|---|
| [Bun](https://bun.sh/docs/installation) **1.4.3+** | runtime, not just for development |
| [`signal-cli`](https://github.com/AsamK/signal-cli) **0.14+** | live mode only; the GraalVM native build needs no Java |
| `qrencode` | `bun run link` renders the QR as an image |

## Quick start

```sh
bun install
bun run setup          # enables the tracked git hooks
bun start              # demo mode — no account needed
```

### Live mode

```sh
bun run link                            # PNG QR → Signal → Settings → Linked devices
bun run doctor -- --account +48…        # checks signal-cli, account, cache, permissions
bun run src/cli.tsx --account +48…      # cache: ~/.local/share/signal-tui/cache.db
```

`bun run link` exists because `signal-cli link` draws its QR with Unicode blocks and
the GraalVM native build ships a US-ASCII charset, so it emits literal `?` bytes —
unusable regardless of your terminal font. The helper reads the `sgnl://` URI
signal-cli prints beside the art and renders a PNG instead.

The cache holds message bodies in plaintext, so it is created `0600` inside a `0700`
directory, and `--db` refuses a directory other users can write to.

## Keys

| Key | Action |
|---|---|
| `j` / `k` | move selection |
| `i`, `/`, `⏎` | compose |
| `⏎` | send (while composing) |
| `Esc` | back to the list |
| `q` | quit |

## What works

- conversations from your account, keyed per group rather than per sender
- sending, with the message appearing immediately (Signal never echoes a transcript
  back to the device that wrote it)
- messages you send elsewhere show up here, with the server timestamp as identity
- unread counts that clear when you open a conversation, and while you watch it
- **read receipts**: the other side sees "read" when you open the chat, not when the
  message arrives
- delete-for-everyone, reflected in the cache
- history persisted across restarts

## Not there yet

Search UI (the FTS5 index exists and is tested), attachments beyond a `[attachment]`
placeholder, applying edits, scrollback past the last 50 messages, typing indicators,
desktop notifications, history from before you linked.

## Scripts

| Script | What it does |
|---|---|
| `bun start` | run the TUI (demo mode) |
| `bun run link` | link this computer to your account, QR as an image |
| `bun run doctor` | check prerequisites; `-- --account +48…` adds the account |
| `bun test` | unit, adapter and ink render tests |
| `bun run verify` | typecheck + lint + tests — the gate CI runs |
| `bun run setup` | `git config core.hooksPath .githooks` |

## Architecture

Ports and adapters: `src/domain` holds no IO, and `src/ui` renders and handles keys
with ink — but neither reaches for an adapter.

```
src/
  domain/     pure types and formatting helpers
  ports/      MessageStore, SignalBackend interfaces
  adapters/   memory/ (demo) · sqlite/ (cache) · signal/ (JSON-RPC)
  app/        reducer + session (events → cache)
  ui/         ink components
  cli.tsx     composition root · link.ts / doctor.ts entry points
```

Boundaries are enforced by `noRestrictedImports` in `biome.json`; CI fails if
`domain` reaches for `ink` or `ui` imports an adapter.

Design decisions live in the vault under `BUILD/signal-tui/`.

## License

MIT — see [LICENSE](./LICENSE).
