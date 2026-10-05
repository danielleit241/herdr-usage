# Changelog

## 0.2.1 - 2026-10-05

- Logos: Claude starburst (`assets/claude-color.svg`) and the Codex cloud without its
  white tile (`assets/codex-color.svg`), both in the same centered box.
- README: no logo images.
- Font is installed under a content-hashed file name, so an update never fails on a
  file the terminal keeps locked.
- README: put `$herdr_usage_icon` in front of `agent`, so the usage row is not cut off.
- Font is now TrueType (`HerdrUsageIcons.ttf`); on Windows `install-font` also loads it
  and broadcasts the font change, like Explorer "Install". It removes the 0.2.0 `.otf`.
- README: Windows Terminal needs `HerdrUsageIcons` in its font list, otherwise it
  shows `?`.

## 0.2.0 - 2026-10-05

- Provider logos: new `$herdr_usage_icon` token (Claude Code `U+10FFE1`, Codex `U+10FFE2`)
  on the usage row, drawn by the bundled `HerdrUsageIcons.otf`.
- `install-font` / `uninstall-font` actions: per-user font install on macOS, Linux and
  Windows (no admin rights).

## 0.1.0 - 2026-10-05

First release.

- Claude Code usage (5h / weekly) from the statusLine `rate_limits` field.
- Codex usage (5h / weekly) from the newest rollout `token_count` events (main `codex` limit only).
- One usage row per provider in the herdr agents sidebar, on the first agent pane, with
  `○ ◐ ●` levels for color rules (<50 %, 50–79 %, ≥80 %).
- Tokens expire at the window reset.
- `install-hooks` / `uninstall-hooks` actions: Claude statusLine (chains an existing one)
  and Codex `Stop` hook, with one-time backups and atomic writes.
- Windows, macOS and Linux; Node.js 18+; no dependencies.
