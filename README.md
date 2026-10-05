# herdr-usage

<p>
  <img src="assets/claude.svg" alt="Claude Code" height="32">
  &nbsp;
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/codex-dark.svg">
    <img src="assets/codex.svg" alt="Codex" height="32">
  </picture>
</p>

A [herdr](https://github.com/herdrdev/herdr) plugin that shows your **Claude Code** and
**Codex** subscription usage (5-hour and weekly windows) in the agents sidebar, once per
provider, colored by level:

```
● local · app · main
  claude
  ○ 5h 21% · ○ wk 28%       ← first Claude agent only
● local · app · main
  claude
● local · api · main
  codex
  ○ 5h 38% · ◐ wk 56%       ← first Codex agent only
```

`○` under 50 %, `◐` 50–79 %, `●` 80 % and over. The sidebar colors them green, yellow
and red; the glyph alone also shows the level.

Works on Windows, macOS and Linux. No dependencies beyond Node.js 18+.

## How it works

```
Claude Code statusLine ─┐                          ┌─ $herdr_usage_1/2 on first claude pane
                        ├─ providers → UsageState ─┤
Codex rollout files ────┘                          └─ $herdr_usage_1/2 on first codex pane
```

- **Providers** (`src/providers/`) read real usage data and normalize it to one
  `UsageState` (`src/usage.js`):
  - **Claude Code**: the documented `rate_limits` field of the
    [statusLine input](https://code.claude.com/docs/en/statusline). Claude Code
    sends it to Pro/Max sessions after the first API response. The statusLine
    command caches the last value.
  - **Codex**: the `rate_limits` of the newest `token_count` event in
    `$CODEX_HOME/sessions/**/rollout-*.jsonl`.
- **Publisher** (`src/herdr.js`) writes one pane token per window (`$herdr_usage_1`,
  `$herdr_usage_2`) with `herdr pane report-metadata`, only on the first agent pane of each
  provider in `herdr agent list` order, and clears them on the other panes. Each token
  has a TTL that ends at its window reset, so stale numbers disappear by themselves.
- **Refresh** comes from the agents: the Claude statusLine (when the numbers change,
  otherwise at most every 15 s) and the Codex `Stop` hook. On Linux/macOS a herdr startup hook and a
  `pane.agent_detected` hook also refresh immediately. Windows skips herdr hooks because
  every console process started from one flashes a Windows Terminal window.

If a provider has no data (not logged in, no subscription, no session yet), its token is
cleared and the row shows the agent name only. Nothing is estimated or invented.

## Install

Requirements: herdr 0.9.0+ and Node.js 18+ on `PATH`.

1. Install the plugin:

   ```sh
   herdr plugin install danielleit241/herdr-usage
   ```

   This installs the latest release: herdr checks out the repository's default branch,
   which is `release` and only moves when a version is published. Development happens
   on `main`. To pin a version, add `--ref v0.1.0`. To update, run the same command
   again.

2. Wire the agent hooks:

   ```sh
   herdr plugin action invoke herdr-usage.install-hooks
   ```

   This edits `~/.claude/settings.json` (`statusLine`) and `~/.codex/hooks.json`
   (`Stop` hook). The first edit keeps the original next to it as
   `settings.json.herdr-usage.bak` / `hooks.json.herdr-usage.bak`. A tool whose config
   directory does not exist is skipped. An existing Claude statusLine keeps working:
   herdr-usage runs it with the shell Claude Code uses (`sh` on macOS/Linux, Git Bash or
   PowerShell on Windows) and prints its output.

   - Codex runs `hooks.json` only with `[features] hooks = true` in
     `~/.codex/config.toml`. `herdr integration install codex` sets it; the action warns
     when it is missing.
   - The action runs in the herdr server's environment. If you set `CLAUDE_CONFIG_DIR`
     or `CODEX_HOME` only in your shell, run `node src/cli.js install` from the plugin
     directory in that shell instead.

3. Show the tokens in the sidebar. Add this to herdr's `config.toml`, then run
   `herdr server reload-config`. The colors below are from the Dracula theme; use any
   `#RRGGBB`.

   ```toml
   [ui.sidebar.agents.rows_by_agent]
   claude = [
     ["state_icon", "machine", "workspace", "tab"],
     ["agent"],
     [
       { token = "$herdr_usage_1", rules = [{ starts_with = "●", fg = "#ff5555" }, { starts_with = "◐", fg = "#f1fa8c" }, { starts_with = "○", fg = "#50fa7b" }] },
       { token = "$herdr_usage_2", rules = [{ starts_with = "●", fg = "#ff5555" }, { starts_with = "◐", fg = "#f1fa8c" }, { starts_with = "○", fg = "#50fa7b" }] },
     ],
   ]
   # Same layout for Codex.
   codex = [
     ["state_icon", "machine", "workspace", "tab"],
     ["agent"],
     [
       { token = "$herdr_usage_1", rules = [{ starts_with = "●", fg = "#ff5555" }, { starts_with = "◐", fg = "#f1fa8c" }, { starts_with = "○", fg = "#50fa7b" }] },
       { token = "$herdr_usage_2", rules = [{ starts_with = "●", fg = "#ff5555" }, { starts_with = "◐", fg = "#f1fa8c" }, { starts_with = "○", fg = "#50fa7b" }] },
     ],
   ]
   ```

   The usage row only appears on the pane that carries the tokens. Panes without them
   keep their normal two lines.

4. Optional: show the Claude and Codex logos in front of the usage row.

   ```sh
   herdr plugin action invoke herdr-usage.install-font
   ```

   This installs `HerdrUsageIcons.otf` for your user only (macOS `~/Library/Fonts`,
   Linux `~/.local/share/fonts`, Windows `%LOCALAPPDATA%\Microsoft\Windows\Fonts` plus
   its `HKCU` registry entry). **Fully quit and reopen your terminal app** so it loads
   the font. Then put the icon token first in each usage row:

   ```toml
   # claude
   [{ token = "$herdr_usage_icon", fg = "#D97757" }, { token = "$herdr_usage_1", rules = [...] }, ...],
   # codex
   [{ token = "$herdr_usage_icon" }, { token = "$herdr_usage_1", rules = [...] }, ...],
   ```

   The logos are single glyphs in the Unicode Private Use Area (`U+100001` Claude,
   `U+100003` Codex), the same codepoints as
   [herdr-agent-icons](https://github.com/adihex/herdr-agent-icons), so either font
   draws them. Without the font the terminal shows an empty box; leave the token out
   of your config in that case.

The numbers appear after the next Claude statusLine update or Codex turn. Run
`herdr plugin action invoke herdr-usage.refresh` to publish them immediately.

## Uninstall

Remove the hooks **before** you uninstall the plugin. Otherwise Claude Code and Codex
keep calling a script that no longer exists.

```sh
herdr plugin action invoke herdr-usage.uninstall-hooks
herdr plugin action invoke herdr-usage.uninstall-font   # if you installed it
herdr plugin uninstall herdr-usage
```

Then remove the `rows_by_agent` lines from `config.toml`.

## Actions

| Action | Purpose |
| --- | --- |
| `herdr-usage.refresh` | Publish usage to the sidebar now |
| `herdr-usage.install-hooks` | Wire the Claude statusLine and the Codex `Stop` hook |
| `herdr-usage.uninstall-hooks` | Undo `install-hooks` and restore a chained statusLine |
| `herdr-usage.install-font` | Install the logo font for `$herdr_usage_icon` (current user) |
| `herdr-usage.uninstall-font` | Remove that font |

`node src/cli.js status` (from the plugin directory) prints the normalized state of every
provider as JSON, which helps when a number does not show up.

## Limits

- Numbers refresh only while a Claude or Codex agent runs. When a window resets, the
  token hides until the next refresh.
- "First agent" follows `herdr agent list` order. With `agent_panel_sort = "priority"` the
  usage row may sit on a lower row of the sidebar.
- With any custom statusLine, Claude Code hides most footer hints such as
  `esc to interrupt`. If you had no statusLine before, herdr-usage prints an empty one.
- Claude usage needs a Claude Pro/Max login. API-key sessions have no `rate_limits`.

## Security and privacy

herdr plugins run as your user without a sandbox (see herdr's
[plugin trust model](https://herdr.dev/docs/plugins/#trust-and-security)). This is
everything herdr-usage does:

- **Reads** the Claude Code statusLine JSON on stdin, and the last 512 KB of your newest
  Codex rollout files. From those it keeps only `rate_limits`. It never stores or logs
  conversation content, and never reads credentials or OAuth tokens.
- **Writes** its cache to herdr's plugin state directory (`HERDR_PLUGIN_STATE_DIR`),
  plus the two hook entries and their one-time `*.herdr-usage.bak` backups described in
  [Install](#install). `install-font` copies one font file to your user font folder
  (and on Windows adds its `HKCU` font entry). It does not write to the plugin
  checkout or to herdr's config.
- **Network**: none. All data is local.
- **herdr**: uses the public CLI only (`agent list`, `pane report-metadata` with its own
  `--source herdr-usage`). Tokens are display-only, expire by TTL and are not
  persisted across a server restart. The Claude statusLine publishes when the numbers
  change, and otherwise at most once per 15 s.
- **Commands**: herdr calls run with `execFile` (no shell). The only shell command is
  your own previous Claude statusLine, which herdr-usage runs exactly as Claude Code did
  before.

Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Development

```sh
npm test
herdr plugin link .
herdr plugin action invoke herdr-usage.install-hooks
```

`fonts/HerdrUsageIcons.otf` is built from `assets/*.svg` and committed, so users need
no build step. After changing a logo, rebuild it with `uv run tools/build-font.py`.

## License

MIT. `tools/build-font.py` is adapted from
[adihex/herdr-agent-icons](https://github.com/adihex/herdr-agent-icons)
(MIT, Copyright (c) 2026 adihex).

Claude is a trademark of Anthropic, and Codex of OpenAI; the logos in `assets/` and
`fonts/` only identify the supported tools. This project is not affiliated with either company.
