# Changelog

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
