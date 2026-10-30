# Records demo/demo.gif, the loop the README opens with.
#
# Needs vhs, ttyd and ffmpeg (`brew install vhs` / `apt install ttyd ffmpeg`, or the
# static builds on github.com/charmbracelet/vhs). Run it from the repo root:
#
#   vhs demo/demo.tape
#
# Everything after the command line is `--demo` mode: built-in sample data, no account and
# no signal-cli, so nothing typed here can reach a phone.

Output demo/demo.gif

Set Shell bash
Set FontFamily "JetBrains Mono"
Set FontSize 15
Set Width 1100
Set Height 680
Set Padding 16
Set MarginFill "#1e1e2e"
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set CursorBlink false

Type "bun run src/cli.tsx --demo"
Enter
Sleep 3s

# The conversation list: unread counts, and the thread follows the pointer.
Type "j"
Sleep 900ms
Type "j"
Sleep 1500ms
Type "k"
Sleep 700ms
Type "k"
Sleep 900ms

# Into the thread, then a reply: `r` quotes the pointed message and hands you the composer.
Tab
Sleep 800ms
Type "r"
Sleep 900ms
Type "yep, chunked it in the PR"
Sleep 700ms
Enter
# The send is echoed into the cache, and the sample thread types back and answers.
Sleep 4s
Tab
Sleep 600ms

# Search reaches across every cached thread; Enter jumps to the hit.
Type "/"
Sleep 700ms
Type "chunk"
Sleep 1500ms
Enter
Sleep 2500ms
