# herdr-usage

A [herdr](https://github.com/herdrdev/herdr) plugin that shows the subscription usage of
your AI coding agents (for example 5-hour and weekly windows) in the agents sidebar,
once per provider, colored by level, with the local time when each window resets:

```
● local · app · main
  claude
  ○ 5h 38% 19:15            ← first agent of a provider only
  ○ Wk 19% Mon 19:15
● local · app · main
  claude
● local · api · main
  codex
  ○ 5h 37% 01:36
  ◐ Wk 64% Sat 06:52
```

`○` under 50 %, `◐` 50–79 %, `●` 80 % and over. The sidebar colors them green, yellow
and red; the glyph alone also shows the level. A reset more than 24 hours away also
shows the weekday.

Works on Windows, macOS and Linux. No dependencies beyond Node.js 18+.

## Supported providers

Each agent tool is one **provider**. A provider reads real usage data for one herdr
agent id and wires the hook that refreshes it.

| Provider | Agent id | Usage data | Refresh trigger | Config edited by the setup | Logo |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `claude` | `rate_limits` in the [statusLine input](https://code.claude.com/docs/en/statusline) (Pro/Max, after the first API response), cached by the statusLine command | statusLine: on change, else at most every 15 s | `~/.claude/settings.json` (`statusLine`) | `U+10FFE1`, `fg = "#D97757"` |
| Codex | `codex` | `rate_limits` of the newest `token_count` event in `$CODEX_HOME/sessions/**/rollout-*.jsonl` | `Stop` hook after each turn | `~/.codex/hooks.json` (`Stop` hook) | `U+10FFE2`, `fg = "#7A9DFF"` |

The logo color of each provider is the `color` in `assets/icons.json`, next to its
glyph codepoint. The setup uses it for the `fg` of the logo token.

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

Requirements: herdr 0.9.3+ (the setup relies on `herdr config check`) and Node.js 18+ on `PATH`.

```sh
herdr plugin install danielleit241/herdr-usage
```

herdr prints a preview of the plugin. It shows the build commands word for word,
including the one that sets everything up. Read it, then answer `y` to
"Install this plugin?". `--yes` skips the question, so use it only when you trust
the plugin.

This installs the latest release: herdr checks out the repository's default branch,
which is `release` and only moves when a version is published. Development happens on
`main`. To pin a version, add `--ref v0.2.2`. To update, run the same command again.

herdr does not show the output of a build command that succeeds. So the setup writes
its full report to `<herdr config dir>/plugins/config/herdr-usage/setup.log` and
sends one herdr notification when it ends: which agents it set up, or "Setup needs
attention". To see what to do, run `herdr plugin action invoke herdr-usage.setup`.

If the install fails halfway, run `herdr plugin install danielleit241/herdr-usage`
again. The setup is safe to repeat. Run the `uninstall` action (see
[Uninstall](#uninstall)) if you want it removed instead.

### What the setup changes

The setup is the second build command of the plugin (`node src/cli.js setup --build`).
It changes only these things. Each step runs on its own: a failure in one step does
not stop the others.

- **Logo font.** Copies `HerdrUsageIcons-<hash>.ttf` to your user font folder (macOS
  `~/Library/Fonts`, Linux `~/.local/share/fonts`, Windows
  `%LOCALAPPDATA%\Microsoft\Windows\Fonts` plus its `HKCU` registry entry). If the
  font is new, **fully quit and reopen your terminal app** so it loads the font.
- **Hook launcher.** Writes `hook.js` to herdr's plugin config directory
  (`<herdr config dir>/plugins/config/herdr-usage/`). The agent hooks call this file,
  which runs the plugin. When the plugin is gone, it does nothing and exits 0, so a
  hook left behind never breaks your agent tool.
- **Agent hooks.** Edits the config file of each provider's tool (see
  [Supported providers](#supported-providers)). The first edit keeps the original next
  to it as `<file>.herdr-usage.bak`. A tool whose config directory does not exist is
  skipped. Other entries in those files are kept.
  - **Claude Code**: an existing statusLine keeps working. herdr-usage runs it with the
    shell Claude Code uses (`sh` on macOS/Linux, Git Bash or PowerShell on Windows) and
    prints its output.
  - **Codex** runs `hooks.json` only with `[features] hooks = true` in
    `~/.codex/config.toml`. `herdr integration install codex` sets it; the setup warns
    when it is missing.
- **herdr `config.toml`.** Adds one block, between the lines
  `# >>> herdr-usage ...` and `# <<< herdr-usage`, with one `rows_by_agent` entry per
  provider:
  - It starts from your own rows (`[ui.sidebar.agents] rows`), or from herdr's default
    rows when you have none. It adds the logo in front of `agent`, and one row per
    usage window.
  - The usage colors are the green, yellow and red of your theme: the built-in palette
    of `[theme] name`, with your `[theme.custom]` values on top. With the `terminal`
    theme (ANSI colors) or an unknown theme, the usage row has no colors.
  - A provider that already has an entry in `[ui.sidebar.agents.rows_by_agent]` is left
    alone, and the setup says so.
  - The setup runs `herdr config check` on your file before and on the new file
    before it replaces yours (a one-time `config.toml.herdr-usage.bak` keeps the
    original). If herdr reports a problem or cannot run, your file stays as it is and
    the setup prints the lines to add by hand (in `setup.log`). Then it runs
    `herdr server reload-config`.
  - Rows set with a dotted key (for example `sidebar.agents.rows = ...` under `[ui]`)
    are not guessed: the setup does not edit the file. Move them under
    `[ui.sidebar.agents]` as `rows = ...` and run the setup again.
  - If you remove one marker line of the block by accident, the setup and the uninstall
    do not edit the file. They name the lines to fix. Other lines between the markers
    (for example a key that herdr itself added) are kept when the block is removed.

The numbers appear after the next refresh trigger of each provider. Run
`herdr plugin action invoke herdr-usage.refresh` to publish them immediately.
The usage rows only appear on the pane that carries the tokens. Panes without them
keep their normal lines.

### Windows Terminal font

Windows Terminal does not use per-user fonts for missing glyphs on its own, and shows
`?` instead. Add the font after your main font in its `settings.json`
(`profiles.defaults`, or one profile):

```json
"font": { "face": "Cascadia Mono, HerdrUsageIcons" }
```

herdr-usage never edits that file. It only reads it: without `HerdrUsageIcons` in it,
the setup leaves the logo out of the rows and prints a hint. After you add the font,
run the setup again (below).

The logos are single-color glyphs in the Unicode Private Use Area, away from the range
other icon fonts use. Their `fg` color comes from `assets/icons.json`.

### Run the setup again

Run it again after you change your theme, your sidebar rows or the Windows Terminal
font. The block is rebuilt from your current config. If nothing changed, the file stays
byte for byte the same.

```sh
herdr plugin action invoke herdr-usage.setup
```

The action runs in the herdr server's environment. If you set `CLAUDE_CONFIG_DIR` or
`CODEX_HOME` only in your shell, run `node src/cli.js setup` from the plugin directory
in that shell instead.

### Manual setup

If you prefer to edit `config.toml` yourself, add one entry per provider agent id, then
run `herdr server reload-config`. Use any `#RRGGBB` colors. The ones below are from the
Dracula theme.

```toml
[ui.sidebar.agents.rows_by_agent]
claude = [
  ["state_icon", "machine", "workspace", "tab"],
  [{ token = "$herdr_usage_icon", fg = "#D97757" }, "agent"],
  [{ token = "$herdr_usage_1", rules = [{ starts_with = "●", fg = "#ff5555" }, { starts_with = "◐", fg = "#f1fa8c" }, { starts_with = "○", fg = "#50fa7b" }] }],
  [{ token = "$herdr_usage_2", rules = [{ starts_with = "●", fg = "#ff5555" }, { starts_with = "◐", fg = "#f1fa8c" }, { starts_with = "○", fg = "#50fa7b" }] }],
]
# Same layout for every other provider: codex = [ ... ]
```

Leave out the `$herdr_usage_icon` item when the font is not installed.

## Uninstall

Undo the setup **before** you uninstall the plugin. Otherwise the entries stay in the
agent config files. The launcher then exits quietly, so nothing breaks, but a Claude
statusLine you had before stays hidden: herdr-usage no longer runs it. To fix that
after the fact, install the plugin again, then run the `uninstall` action.

```sh
herdr plugin action invoke herdr-usage.uninstall
herdr plugin uninstall herdr-usage
```

The `uninstall` action removes the agent hooks (and restores a chained Claude
statusLine), the block in `config.toml` and the logo font. It keeps `hook.js` (it does
nothing without the hooks) and writes a `disabled` file next to it: while that file
exists, updating the plugin does not set anything up again. Run the `setup` action to
enable it again. herdr does not remove a plugin's config and state directories; delete
`<herdr config dir>/plugins/config/herdr-usage/` and the plugin state directory if you
want them gone.

## Actions

| Action | Purpose |
| --- | --- |
| `herdr-usage.refresh` | Publish usage of every provider to the sidebar now |
| `herdr-usage.setup` | Run the setup again: font, launcher, agent hooks, `config.toml` rows |
| `herdr-usage.uninstall` | Undo the setup. Run it before `herdr plugin uninstall` |

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
- **Writes** its cache to herdr's plugin state directory (`HERDR_PLUGIN_STATE_DIR`).
  The setup, which runs as a build step after you confirm the install preview, also
  writes what [Install](#what-the-setup-changes) lists: the hook entries of the agent
  tools, the managed block in herdr's `config.toml`, one font file in your user font
  folder (on Windows with its `HKCU` font entry) and `hook.js` in herdr's plugin config
  directory. Each edited file keeps a one-time `*.herdr-usage.bak` copy of the original.
  The new `config.toml` is checked with `herdr config check` before it replaces yours;
  when the check fails, your file stays as it is. It never edits Windows Terminal
  settings (it only reads them to see if the font is listed).
- **Network**: none. All data is local.
- **herdr**: uses the public CLI only (`agent list`, `pane report-metadata` with its own
  `--source herdr-usage`, `config check`, `server reload-config`). Tokens are display-only, expire by TTL and are not
  persisted across a server restart.
- **Commands**: herdr calls run with `execFile` (no shell). The only shell command is
  your own previous Claude statusLine, which herdr-usage runs exactly as Claude Code did
  before.

Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

## Development

```sh
npm test
herdr plugin link .
herdr plugin action invoke herdr-usage.setup
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

`setup`, `uninstall`, `status`, `publish` and the hook commands pick up the new
provider without other changes. Only read local data that the tool documents or writes
itself; never read credentials.

## License

MIT. `tools/build-font.py` is adapted from
[adihex/herdr-agent-icons](https://github.com/adihex/herdr-agent-icons)
(MIT, Copyright (c) 2026 adihex).

Claude is a trademark of Anthropic, and Codex of OpenAI; the logos in `assets/` and
`fonts/` only identify the supported tools. This project is not affiliated with either company.
