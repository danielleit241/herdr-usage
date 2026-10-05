# herdr-usage

A [herdr](https://github.com/herdrdev/herdr) plugin that shows the subscription usage of
your AI coding agents (for example 5-hour and weekly windows) in the agents sidebar,
once per provider, colored by level:

```
● local · app · main
  claude
  ○ 5h 21% · ○ wk 28%       ← first agent of a provider only
● local · app · main
  claude
● local · api · main
  codex
  ○ 5h 38% · ◐ wk 56%
```

`○` under 50 %, `◐` 50–79 %, `●` 80 % and over. The sidebar colors them green, yellow
and red; the glyph alone also shows the level.

Works on Windows, macOS and Linux. No dependencies beyond Node.js 18+.

## Supported providers

Each agent tool is one **provider**. A provider reads real usage data for one herdr
agent id and wires the hook that refreshes it.

| Provider | Agent id | Usage data | Refresh trigger | Config edited by `install-hooks` | Logo |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `claude` | `rate_limits` in the [statusLine input](https://code.claude.com/docs/en/statusline) (Pro/Max, after the first API response), cached by the statusLine command | statusLine: on change, else at most every 15 s | `~/.claude/settings.json` (`statusLine`) | `U+10FFE1`, `fg = "#D97757"` |
| Codex | `codex` | `rate_limits` of the newest `token_count` event in `$CODEX_HOME/sessions/**/rollout-*.jsonl` | `Stop` hook after each turn | `~/.codex/hooks.json` (`Stop` hook) | `U+10FFE2`, `fg = "#7A9DFF"` |

Other agents are not supported yet. To add one, see
[Adding a provider](#adding-a-provider).

## How it works

```
provider A tool ─┐                              ┌─ $herdr_usage_* on the first pane of agent A
provider B tool ─┼─ providers → UsageState ─────┼─ $herdr_usage_* on the first pane of agent B
...             ─┘   (src/providers/)           └─ ...
```

- **Providers** (`src/providers/`) read real usage data and normalize it to one
  `UsageState` (`src/usage.js`): a provider id, a status, and a list of windows with
  used percent and reset time.
- **Publisher** (`src/herdr.js`) writes one pane token per window (`$herdr_usage_1`,
  `$herdr_usage_2`) and the logo token (`$herdr_usage_icon`) with
  `herdr pane report-metadata`. It writes them only on the first agent pane of each
  provider in `herdr agent list` order, and clears them on the other panes. Each token
  has a TTL that ends at its window reset, so stale numbers disappear by themselves.
- **Refresh** comes from the agents: each provider installs a hook in its tool (see
  [Supported providers](#supported-providers)). On Linux/macOS a herdr startup hook and
  a `pane.agent_detected` hook also refresh immediately. Windows skips herdr hooks
  because every console process started from one flashes a Windows Terminal window.

If a provider has no data (not logged in, no subscription, no session yet), its tokens
are cleared and the row shows the agent name only. One provider failing never hides the
others. Nothing is estimated or invented.

## Install

Requirements: herdr 0.9.0+ and Node.js 18+ on `PATH`.

1. Install the plugin:

   ```sh
   herdr plugin install danielleit241/herdr-usage
   ```

   This installs the latest release: herdr checks out the repository's default branch,
   which is `release` and only moves when a version is published. Development happens
   on `main`. To pin a version, add `--ref v0.2.1`. To update, run the same command
   again.

2. Wire the provider hooks:

   ```sh
   herdr plugin action invoke herdr-usage.install-hooks
   ```

   This edits the config file of each provider's tool (see
   [Supported providers](#supported-providers)). The first edit keeps the original next
   to it as `<file>.herdr-usage.bak`. A tool whose config directory does not exist is
   skipped. Other entries in those files are kept.

   - **Claude Code**: an existing statusLine keeps working. herdr-usage runs it with the
     shell Claude Code uses (`sh` on macOS/Linux, Git Bash or PowerShell on Windows) and
     prints its output.
   - **Codex** runs `hooks.json` only with `[features] hooks = true` in
     `~/.codex/config.toml`. `herdr integration install codex` sets it; the action warns
     when it is missing.
   - The action runs in the herdr server's environment. If you set `CLAUDE_CONFIG_DIR`
     or `CODEX_HOME` only in your shell, run `node src/cli.js install` from the plugin
     directory in that shell instead.

3. Show the tokens in the sidebar. Add one entry per provider agent id to herdr's
   `config.toml`, then run `herdr server reload-config`. The colors below are from the
   Dracula theme; use any `#RRGGBB`.

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
   # Same layout for every other provider: codex = [ ... ]
   ```

   The usage row only appears on the pane that carries the tokens. Panes without them
   keep their normal two lines.

4. Optional: show the provider logo in front of the agent name.

   ```sh
   herdr plugin action invoke herdr-usage.install-font
   ```

   This installs `HerdrUsageIcons.ttf` for your user only (macOS `~/Library/Fonts`,
   Linux `~/.local/share/fonts`, Windows `%LOCALAPPDATA%\Microsoft\Windows\Fonts` plus
   its `HKCU` registry entry). **Fully quit and reopen your terminal app** so it loads
   the font. Then put the icon token in front of `agent`, so the usage row keeps its
   width. Use the provider's color from [Supported providers](#supported-providers):

   ```toml
   [{ token = "$herdr_usage_icon", fg = "#D97757" }, "agent"],   # claude
   ```

   The icon shows on the pane that carries the usage row.

   **Windows Terminal** does not use per-user fonts for missing glyphs on its own and
   shows `?` instead. List the font after your main font in `settings.json`
   (`profiles.defaults`, or one profile):

   ```json
   "font": { "face": "Cascadia Mono, HerdrUsageIcons" }
   ```

   The logos are single-color glyphs in the Unicode Private Use Area, away from the
   range other icon fonts use. The `fg` sets their color. Without the font the terminal
   shows an empty box; leave the token out of your config in that case.

The numbers appear after the next refresh trigger of each provider. Run
`herdr plugin action invoke herdr-usage.refresh` to publish them immediately.

## Uninstall

Remove the hooks **before** you uninstall the plugin. Otherwise the agent tools keep
calling a script that no longer exists.

```sh
herdr plugin action invoke herdr-usage.uninstall-hooks
herdr plugin action invoke herdr-usage.uninstall-font   # if you installed it
herdr plugin uninstall herdr-usage
```

Then remove the `rows_by_agent` lines from `config.toml`.

## Actions

| Action | Purpose |
| --- | --- |
| `herdr-usage.refresh` | Publish usage of every provider to the sidebar now |
| `herdr-usage.install-hooks` | Wire the refresh hook of every provider whose tool is installed |
| `herdr-usage.uninstall-hooks` | Undo `install-hooks` (restores a chained Claude statusLine) |
| `herdr-usage.install-font` | Install the logo font for `$herdr_usage_icon` (current user) |
| `herdr-usage.uninstall-font` | Remove that font |

`node src/cli.js status` (from the plugin directory) prints the normalized state of every
provider as JSON, which helps when a number does not show up.

## Limits

- Numbers refresh only while an agent of that provider runs. When a window resets, the
  token hides until the next refresh.
- "First agent" follows `herdr agent list` order. With `agent_panel_sort = "priority"` the
  usage row may sit on a lower row of the sidebar.
- Claude Code: with any custom statusLine, Claude Code hides most footer hints such as
  `esc to interrupt`. If you had no statusLine before, herdr-usage prints an empty one.
- Claude Code: usage needs a Claude Pro/Max login. API-key sessions have no
  `rate_limits`.

## Security and privacy

herdr plugins run as your user without a sandbox (see herdr's
[plugin trust model](https://herdr.dev/docs/plugins/#trust-and-security)). This is
everything herdr-usage does:

- **Reads** only the usage data listed in [Supported providers](#supported-providers):
  the Claude Code statusLine JSON on stdin, and the last 512 KB of your newest Codex
  rollout files. From those it keeps only `rate_limits`. It never stores or logs
  conversation content, and never reads credentials or OAuth tokens.
- **Writes** its cache to herdr's plugin state directory (`HERDR_PLUGIN_STATE_DIR`),
  plus the hook entries and their one-time `*.herdr-usage.bak` backups described in
  [Install](#install). `install-font` copies one font file to your user font folder
  (and on Windows adds its `HKCU` font entry). It does not write to the plugin
  checkout or to herdr's config.
- **Network**: none. All data is local.
- **herdr**: uses the public CLI only (`agent list`, `pane report-metadata` with its own
  `--source herdr-usage`). Tokens are display-only, expire by TTL and are not
  persisted across a server restart.
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

`fonts/HerdrUsageIcons.ttf` is built from the SVGs listed in `assets/icons.json` and
committed, so users need no build step. After changing a logo, rebuild it with
`uv run tools/build-font.py`.

### Adding a provider

Every provider follows one contract, documented in `src/providers/index.js`:

1. Write `src/providers/<id>.js`, where `<id>` is the herdr agent id. It exports
   `id`, `configDir`, `read` (returns a usage state), `install`, `uninstall`, and
   `hooks` (the CLI commands that the tool runs to refresh usage).
2. Add it to `PROVIDERS` in `src/providers/index.js`.
3. Optional logo: add `assets/<id>.svg` and an entry in `assets/icons.json`, then
   rebuild the font. Never change an existing codepoint.
4. Add a row to [Supported providers](#supported-providers), and list what it reads in
   [Security and privacy](#security-and-privacy).

`install`, `uninstall`, `status`, `publish` and the hook commands pick up the new
provider without other changes. Only read local data that the tool documents or writes
itself; never read credentials.

## License

MIT. `tools/build-font.py` is adapted from
[adihex/herdr-agent-icons](https://github.com/adihex/herdr-agent-icons)
(MIT, Copyright (c) 2026 adihex).

Claude is a trademark of Anthropic, and Codex of OpenAI; the logos in `assets/` and
`fonts/` only identify the supported tools. This project is not affiliated with either company.
