# Changelog

Notable changes, newest first. This file starts at 0.1.0 — earlier versions are in the
[releases](https://github.com/dandrok/signal-tui/releases).

`0.5.0` is the release where a received file opens: `o` hands it to your desktop, and `doctor`
starts saying when the engine is drifting rather than only when it is ancient.

## [0.5.0] — 2026-10-29

### Added

- **Open a received file** (`o`): the path `signal-cli` downloaded goes to your desktop's viewer
  (`xdg-open`, `open` on macOS). A message carrying several files opens a picker — `⇥`/`↑↓` walk
  it, `⏎` opens the highlighted one, and the list is frozen on the keystroke so `⏎` opens the row
  you are looking at. One file shows as `name 1/1` and opens on `⏎`; after the first successful
  open of the run, a one-file row opens with no prompt at all. This is the first thing the client
  does that leaves the terminal, so the rule is fixed in the use case: **only a file inside the
  engine's own attachments directory is launched** — `<data-dir>/attachments/<id>`, with `--config`
  and `--data-dir` honoured — and anything else is refused by name, without the path ever being
  probed for existence. A deleted, expired or view-once row, a file the engine kept no copy of
  (that includes everything you sent yourself), and a file that has left the disk each say why
  instead of doing nothing.
- **`doctor` warns when the engine drifts**: `0.14.9` is the release this build was verified
  against, `0.14.0` stays the floor. Below the floor it fails, between the two it warns and names
  both versions, above it says which one it was tested with. signal-cli has a roughly three-month
  compatibility clock, so "newer than 0.14.0" can be true, runnable, and about to silently stop
  receiving — which is not an `ok`.

### Fixed

- Confirming `o` in `--demo`, where there is no engine, did nothing at all: the prompt's effect was
  reachable only with a session, and a launch never needed one.
- The status line advertises `o` only for a row whose file the engine actually kept, so the hint
  cannot offer a key that would refuse.

### Internal

- **The open slice is a folder** (`src/app/usecases/open/`) split by how often each question is
  asked: `candidates` (what a row offers, from the paths' text alone — the status line asks it on
  every keystroke), `plan` (the same list once the disk agrees, and whether one may launch),
  `root` (which directory, and the boundary test), `launch` (a launch resolves "it did not fail
  immediately": `xdg-open` forks and then exits `3` when nothing handles the file, so the notice
  follows a 500 ms window rather than a `spawn` event), `context` (the wiring a test replaces).
- **`Attachment.id` is the file's name on disk; `filename` is what the sender called it.** A
  comment said the opposite, and `o` first shipped refusing every live attachment because of it.
  Checked against a real cache rather than the comment: 32 rows, 30 with an id, all 30 present at
  `<root>/<id>` with matching sizes.
- **The engine's data directory is one option with four names** — `-d`, `--data-dir`, `-c`,
  `--config` (`App.java:72` at v0.14.9) — so every spelling is read, and `undefined`/relative
  `XDG_DATA_HOME` behaviour matches the engine's.
- `state/prompt-refusals.ts` and `state/prompt-types.ts` split out of files that crossed the
  200-line cap; `ui/hooks/open-effect.ts` holds the one prompt effect that needs no session.
- No schema change: an existing cache opens as it is, still at version 10. 885 tests across 102
  files.

## [0.4.0] — 2026-10-28

### Added

- **Send a file** (`a`): the path prompt opens on the directory the client was started in. Typing
  narrows the listing, `⇥`/`↑↓` walk it, `⏎` on a folder descends into it and `⏎` on a file sends
  it. `~` is your home, and a dotfile stays out of the list until you type the dot — a picker
  that opens on `.bashrc` is worse than one that shows nothing. One file per message, up to
  Signal's 100 MB; an empty file and anything over the cap are refused before an upload starts,
  because a refused upload is a slower way of saying no.
- **The composer's words travel with the file.** "here's the CV" then `a` is one message, not a
  file followed by a sentence you have to paste back in: the draft is the message the attachment
  belongs to, and a reply in progress is answered — the quote and the file are not alternatives,
  the same rule `⏎` on a draft already followed. An empty composer sends a file with no text,
  which is a legal message.
- **`ignoreAttachments`**, as a config key, as `SIGNAL_TUI_IGNORE_ATTACHMENTS`, and as
  `--ignore-attachments`, resolved `flag > env > file > default` like every other setting. It is
  the only lever that stops `signal-cli` writing every file of every received message into
  `~/.local/share/signal-cli/attachments`, where nothing ever deletes it. Turning it on costs the
  file **names** — the engine never downloads what it was told to ignore, so it cannot report one,
  and the row falls back to `📎 image/jpeg (1.6 MB)`. That trade is stated next to the key in the
  README, because a preference that quietly makes the thread worse is not one worth hiding.

### Changed

- **A refused send gives the words back.** The composer is emptied when a file is submitted, the
  way `⏎` empties it, but a failure now restores the draft and its reply target instead of leaving
  you to retype a sentence you already wrote. Only into an empty box: a draft typed since is newer
  than the one that failed, and recovering old text by overwriting new text would be a second loss
  rather than a fix.

### Internal

- **The attachment slice is a folder** (`src/app/usecases/attach/`) with two halves and a barrel:
  `listing` answers *what can I pick* on every keystroke, `plan` answers *what happens if I pick
  this* once, on `⏎`. The listing is read inside the keystroke that changed the draft, so `a` then
  `⏎` in one tick sends the file the row was showing rather than the one before it.
- **Each prompt's confirm branch lives in `ui/hooks/prompt-effect.ts`**, and the backend's receive
  path in `signal-cli-backend/events.ts`: `useRootState` and the backend class had both passed the
  200-line cap, and neither was one subject any more.
- **`--ignore-attachments` is a `jsonRpc` argument, not a global one.** Checked against
  `signal-cli` v0.14.9: it is declared by `JsonRpcDispatcherCommand.attachToSubparser`, so it
  belongs after the subcommand, where `engineArgs` — placed before it, beside `--config` and the
  proxy flags — could never have put it. Both positions are pinned by a test.
- No schema change: an existing cache opens as it is. 836 tests across 100 files.

## [0.3.0] — 2026-10-28

### Added

- **Forward a message** (`f`): the picker opens over the conversations, typing narrows it by name,
  `⇥`/`↑↓` choose and `⏎` sends the same words on. Signal has no `forward` command and no
  "forwarded" field, so this is an ordinary send addressed elsewhere — which is also why the copy
  is text only: a message carrying files is refused out loud rather than sent as its caption. The
  chat the message came from is not one of the destinations.
- **Typing indicators**: a peer composing in the thread you have open fills the composer's empty
  row with `Marta is typing…`. It goes away on its own, because Signal never says "gave up":
  eight seconds is the deadline, and STOPPED ends it sooner when the other side sends one.
  Nothing is stored — a notice about the present lives in memory — so opening the client
  tomorrow never shows someone mid-sentence from last night.
- **A settings file** at `$XDG_CONFIG_HOME/signal-tui/config.json` (else
  `~/.config/signal-tui/config.json`) with `notify`, `db` and `engineArgs`, resolved per setting
  as `flag > env > file > default`. `--notify`/`--no-notify` and `SIGNAL_TUI_NOTIFY` override it
  for one run; `--db` and `SIGNAL_TUI_DB` do the same for the cache. Engine arguments are
  file-only — they are a standing preference — and are placed before `signal-cli`'s own
  subcommand, where its global options belong.
- A config file that cannot be used exits with the path and the offending setting instead of a
  shrug: an unknown key, a value of the wrong type or unreadable JSON is a mistake worth naming,
  and a silently ignored key is how a typo becomes "the binary is broken".

### Changed

- **Notifications can be switched off without muting the inbox.** `--no-notify`, the environment
  or the config file stop the toast and the bell; the unread badge and the window title still
  count what arrived, because they are not interruptions.
- The README's key table is one table again — a paragraph had split it in two, so four rows
  rendered as a second table with no header.

### Internal

- **The keymap is one file per mode** (`src/ui/keys/`): the map reached 201 lines against a hard
  cap of 200, so `types`, `search`, `prompt`, `composer` and `panes` sit behind a barrel that owns
  only the order they are asked in. A fifth prompt kind now has somewhere to be added without
  lengthening the file that orders them.
- **A forward freezes its candidate list** (`PromptState.candidates`) when the picker opens. The
  conversation list is ordered by activity, so an index resolved at confirm time could name
  whoever slid into that row — the row that is drawn and the row that is sent are now the same
  snapshot.
- **Typing never reaches the store or the write queue**, and a STOPPED for someone who was not
  showing is not a redraw. Its group id registers the group, because a typing notice can be the
  first thing a session sees from one.
- `.gitignore` said `node_modules/`, which matches a directory but not a symlink, so a worktree's
  link to the shared install could be committed — and was, breaking `bun install` on CI. The
  pattern matches either form now.
- No schema change: an existing cache opens as it is. 799 tests across 97 files.

## [0.2.0] — 2026-10-27

### Added

- **Edit your own message** (`e`): the prompt opens with the body it would replace, `⏎` saves,
  `Esc` cancels. The row reads `· edited` immediately — Signal never echoes a send back to the
  device that wrote it, so the local echo is what makes the change visible at all.
- **Delete for everyone** (`d`): asks first (`⏎` or `y`), then removes the message here and on
  every other device. Offered only on your own, still-standing messages.
- **Hide locally** (`D`): the row stays in the cache so a replayed envelope cannot arrive as new,
  but no read returns it — not the thread, not an older page, not search. Nothing goes on the
  wire.
- **A reaction picker**, because a terminal cannot insert an emoji: `x` opens with five
  suggestions, `⇥`/`↑↓` walk them, and `⏎` sends the highlighted one. Typing narrows the list by
  name — `heart`, `redheart`, `red heart`, `:tada:`, `laugh` — from a curated table of ~50
  entries with aliases (`src/domain/emoji-catalog.ts`), not Unicode's 3600.
- **Taking a reaction back**: typing the emoji you already added now removes it, instead of
  adding a twin. The wire took `remove` all along; the key did not offer it.

### Fixed

- **Reacting could refuse the emoji you just typed** ("not one emoji: nothing sent"), with the
  emoji plainly visible in the prompt. The prompt's draft was read from a ref that `setState`
  only refreshed on the next render, so a keystroke handled in the same tick as Enter reached
  the send path as an empty draft. The reducer now runs synchronously and the ref holds the
  result, which fixes it for every prompt — and for the reply target, which had the same race.
- A refusal now says **what** it refused — `not one emoji: 2 characters (U+1F44D U+1F44D)` —
  because "nothing sent" was the same sentence for an empty prompt, two emoji and a paste.

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
