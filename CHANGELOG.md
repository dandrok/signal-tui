# Changelog

Notable changes, newest first. This file starts at 0.1.0 — earlier versions are in the
[releases](https://github.com/dandrok/signal-tui/releases).

## [Unreleased]

### Added

- **Edit your own message** (`e`): the prompt opens with the body it would replace, `⏎` saves,
  `Esc` cancels. The row reads `· edited` immediately — Signal never echoes a send back to the
  device that wrote it, so the local echo is what makes the change visible at all.
- **Delete for everyone** (`d`): asks first (`⏎` or `y`), then removes the message here and on
  every other device. Offered only on your own, still-standing messages.
- **Hide locally** (`D`): the row stays in the cache so a replayed envelope cannot arrive as new,
  but no read returns it — not the thread, not an older page, not search. Nothing goes on the
  wire.
- **Taking a reaction back**: typing the emoji you already added now removes it, instead of
  adding a twin. The wire took `remove` all along; the key did not offer it.

### Changed

- The status line only offers `e` and `d` while the pointer is on **your own** message, and
  pressing one on someone else's now says why instead of silently doing nothing. A notice also
  leads the status row now: it is the reason nothing happened, and Ink truncates from the end.
- The three message actions share one prompt (`state.prompt` with a kind) instead of a
  reaction-only one, so the keymap, the status line and the composer frame each had one rule to
  learn rather than three. The delete prompt is confirmed, never typed into: it is the one
  keystroke that changes what other people see.

### Internal

- Schema **v10**: `messages.is_hidden`, filtered on every read path *and* in the FTS query.
- Both stores answer `hideMessage` with "did a visible row change", so pressing `D` twice
  redraws once — the same contract the receipts and reactions already had.
- Wire shapes checked against signal-cli v0.14.9: **an edit is a `send` with `editTimestamp`**
  (`SendCommand` → `sendEditMessage`), and **a delete is its own method, `remoteDelete`**
  (`RemoteDeleteCommand`). Passing one for the other produces an envelope nobody reads.

## [0.1.0] — 2026-10-27

The release where the tree became one concern per file, and the composer stopped being the only
thing a key could write with.

### Added

- **Send a reaction.** `x` on the selected message opens a prompt in the composer's frame; type
  one emoji, `⏎` sends it, `esc` cancels. It appears immediately, because Signal never echoes a
  send back to the device that wrote it. Two emoji or a pasted paragraph are refused with a
  notice rather than truncated, and a deleted or expired message opens no prompt at all.
- A message you edit from another device now reaches this one as an edit (`syncMessage`'s
  `editMessage`), including a group edit that arrives with no destination.

### Fixed

- **Blank rows in the thread.** A sticker, poll, pin, group-call update, payment or shared
  contact carried no text or files but was still written as a message: a blank line, a bumped
  conversation, an unread count and a notification with no words in it — one per few seconds
  while a group call rang. They are events about something else and no longer produce a message.
- A payload with no timestamp no longer reaches the cache. It used to fail on `messages.sent_at`,
  surfacing as an error notice for a message that was never there.
- A disappearing-message timer change is kept. It carries no content, so the guard above would
  have dropped it — and our own outgoing messages are stamped from that number.

### Changed

- **The codebase, completely.** No source file is over 200 lines, which is a test and a lint rule
  rather than an intention. Each adapter answers in the same three files (which rows, what a
  conversation is, what a message becomes) and `tests/store-parity.test.ts` runs one script
  through both to keep them honest. The signal adapter is four modules — envelope mapping,
  schemas, the JSON-RPC client and its framing, the backend — and the UI's thread pane is a
  window rule, a row and a pane.
- `doctor` is a folder of checks rather than one file, so each check states its own advice; the
  report is unchanged.

### Internal

- 682 tests across 84 files; `bun run verify` is typecheck + lint + test.
- Import cycles: none, and no allowlist for one. Layering (`domain → ports → app → ui`) is
  enforced by `noRestrictedImports`, and a folder is entered through its `index.ts`.
