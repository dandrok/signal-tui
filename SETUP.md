# Setup

Everything `signal-tui` needs from the rest of the system, in the order that
breaks least. Roughly ten minutes, and only the linking step needs your phone.

`signal-tui` is a front end: it does not talk to Signal and cannot create a
linked device by itself. `signal-cli` does both, so it comes first.

| # | What | Needed for |
|---|---|---|
| 1 | Bun 1.4.3+ | running `signal-tui` at all |
| 2 | `signal-cli` 0.14+ | live mode: talking to Signal |
| 3 | `qrencode` | linking: it is what turns the URI into something a phone can scan |
| 4 | Linking this computer | live mode: a device on your account |

---

## 1. Bun

```sh
curl -fsSL https://bun.sh/install | bash
bun --version          # 1.4.3 or newer
```

`signal-tui`'s bin is run by `bun` (its shebang), so Bun is a runtime dependency,
not a build tool — `npm i -g signal-tui` is enough on its own only if `bun` is on
`PATH`.

## 2. signal-cli

Two builds exist. **Prefer the native one**: it is a self-contained binary with no
Java runtime, and it starts faster.

| Build | Asset | Needs Java |
|---|---|---|
| native (GraalVM) | `signal-cli-<version>-Linux-native.tar.gz` | no |
| JVM | `signal-cli-<version>.tar.gz` / `-Linux-client.tar.gz` | Java 25+ |

### Download and verify

Releases are at <https://github.com/AsamK/signal-cli/releases>. Pick the latest
version — `0.14.9` here — and verify the archive against the signature AsamK
publishes before running it:

```sh
VERSION=0.14.9
BASE="https://github.com/AsamK/signal-cli/releases/download/v$VERSION"
curl -LO "$BASE/signal-cli-$VERSION-Linux-native.tar.gz"
curl -LO "$BASE/signal-cli-$VERSION-Linux-native.tar.gz.asc"

curl -sL https://github.com/AsamK.gpg | gpg --import
gpg --verify "signal-cli-$VERSION-Linux-native.tar.gz.asc" \
             "signal-cli-$VERSION-Linux-native.tar.gz"
```

Expected key:

```
pub   rsa2048 2016-06-18 [SC]
      FA10826A74907F9EC6BBB7FC2BA2CD21B5B09570
uid           AsamK <asamk@gmx.de>
```

`Good signature … but the key is not certified with a trusted signature` is
expected: the key came from the same GitHub account that published the release, so
this proves the file matches **that account** — not that the account was never
compromised. Say so to yourself honestly; it is still worth more than nothing.

If the signature does not verify, stop. Do not run the binary.

### Install

```sh
mkdir -p ~/.local/opt/signal-cli-$VERSION ~/.local/bin
# The archive holds exactly one file — the binary itself, ~400 MB unpacked — and
# no bin/ or lib/ tree, so extract it into a versioned directory of its own.
tar -xzf "signal-cli-$VERSION-Linux-native.tar.gz" -C ~/.local/opt/signal-cli-$VERSION
ln -sf ~/.local/opt/signal-cli-$VERSION/signal-cli ~/.local/bin/signal-cli

# ~/.local/bin must be on PATH; most distros already do this
signal-cli --version
```

On Arch, the AUR package tracks the same version if you would rather have a
package: `signal-cli` in `yay`/`paru` (`0.14.9-1`, ~35 votes). Check what it
installs before trusting it the same way you would the archive.

**JVM build instead?** `0.14.9` needs **Java 25** or newer on `PATH` — its README says
"at least JRE 25", so 21 compiles nothing and runs nothing here:

```sh
java --version         # 25 or newer
```

## 3. qrencode

Both linking routes use it, and neither has a text fallback: without `qrencode`,
`bun run link` prints the raw URI plus install instructions and stops — no PNG,
nothing to scan. Route A (`qrencode -t ANSIUTF8`) draws the code straight into the
terminal, so nothing touches the filesystem.

You *can* link without it, by rendering that URI yourself — but the URI is a
credential: anyone who scans or reads it can attach to your account. Use a local QR
app, not a website. Installing `qrencode` is the shorter path.

```sh
# Debian / Ubuntu
sudo apt install qrencode
# Arch
sudo pacman -S qrencode
# macOS
brew install qrencode
```

## 4. Link this computer

Linking makes this machine a **device on your account**. Your phone must scan a QR
code — no tool can skip that step, including this one.

### Route A — from the command line (no clone needed)

```sh
signal-cli link -n signal-tui
```

It prints a `sgnl://linkdevice?…` URI. The native build draws its QR with a
US-ASCII charset, so the pretty block art comes out as literal `?` characters —
that is a known upstream quirk, not your terminal. Render the URI yourself:

```sh
signal-cli link -n signal-tui | grep -o 'sgnl://[^ ]*' \
  | tr -d '\n' | qrencode -t ANSIUTF8
```

The URI arrives on **stdin**, not as an argument — `qrencode` reads it from there when
handed no file. That matters: a command line is readable by every user on the machine
through `/proc/<pid>/cmdline`, and a device-link URI is a credential.

Then on your phone: **Signal → Settings → Linked devices → Link new device**, and
scan it.

### Route B — a PNG instead of terminal art

`link` is a script, not a subcommand, so it runs with Bun from a clone **or** from
the installed package directory — whichever you already have:

```sh
git clone https://github.com/dandrok/signal-tui && cd signal-tui
bun install
bun run link
```

With the npm package instead, run the same script from its directory:

```sh
cd ~/.bun/install/global/node_modules/signal-tui && bun run link
```

This writes a PNG in a private temp directory and opens the path for you; scan it
the same way. The file is deleted on exit, and on `Ctrl-C`.

### Confirm

```sh
signal-cli listAccounts        # prints the linked number
```

Success looks like `Associated with: +48…`. If it hangs, the phone has not finished
scanning.

### Unlink later

**Signal → Settings → Linked devices → signal-tui → Remove.** The account keys in
`~/.local/share/signal-cli` are useless after that; delete them if you are retiring
the machine.

## 5. First run

```sh
signal-tui --demo                       # interface only: no account, no signal-cli
signal-tui --account +48123456789       # live
```

The first live run syncs what your account can see, which can take a moment on a
busy account. History from before this device was linked is **not** available —
Signal does not backfill it to a new linked device.

## Where things live

| Path | What | Protection |
|---|---|---|
| `~/.local/share/signal-cli/` | account keys, and downloaded attachments | your `$HOME` |
| `~/.local/share/signal-cli/attachments/` | files received (this app never downloads them) | your `$HOME` |
| `$XDG_DATA_HOME/signal-tui/cache.db`, or `~/.local/share/signal-tui/cache.db` when it is unset | decrypted message cache + search index | `0600` in a `0700` directory |
| `~/.local/opt/signal-cli-<version>/signal-cli` | the engine (one 400 MB binary) | your `$HOME` |

All of it is plaintext: full-disk encryption is what protects it at rest. `--db`
lets you move the cache, and it refuses a directory other users can write to.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `signal-cli not found` | not on `PATH` | `ln -sf … ~/.local/bin`, ensure `~/.local/bin` is on `PATH` |
| `Error: could not find or load main class` | JVM build without Java | install Java 25+, or use the native build |
| QR is a grid of `?` | native build's US-ASCII charset | render the `sgnl://` URI with `qrencode` (route A) |
| `ExceptionInInitializerError`, `No space left on device` | signal-cli unpacks libsignal into `/tmp` | `JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=/some/roomy/dir" signal-cli listAccounts` (JVM build; swap `listAccounts` for the command you run) |
| links fine, but the TUI shows nothing | no `--account`, or wrong number | `signal-cli listAccounts` |
| `you are already linked` | device already registered | `listAccounts`, or remove the old device in Signal |
| incoming messages never appear | a second process holds the account | run one `signal-cli`/`signal-tui` per account |
| `unknown option: doctor` | `doctor` is not a subcommand — it is a script | `bun run doctor -- --account +48123456789` from a clone or from the installed package directory (`~/.bun/install/global/node_modules/signal-tui`) |
