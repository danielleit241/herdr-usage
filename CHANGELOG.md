# Changelog

## 0.2.2 - 2026-10-05

- Sidebar: each usage window has its own row with its local reset time
  (`○ 5h 38% 19:15`, `○ Wk 19% Mon 19:15`); the weekday shows when the reset is more
  than 24 hours away. The weekly label is now `Wk`.
- Install: `herdr plugin install danielleit241/herdr-usage` now sets everything up. A
  second `[[build]]` command (`node src/cli.js setup --build`) installs the logo font,
  writes the hook launcher, wires the Claude Code and Codex hooks and adds the sidebar
  rows to herdr's `config.toml`. herdr shows that command in its install preview and
  asks before it runs. herdr hides the output of a successful build, so the setup writes
  `setup.log` (in the plugin config directory) and sends a herdr notification.
- Sidebar rows: the setup writes one managed block into `config.toml`. It starts from
  your own `[ui.sidebar.agents] rows`, adds the logo and the usage row, and colors the
  usage with the green, yellow and red of your theme (built-in palette plus
  `[theme.custom]`). The file is checked with `herdr config check` before it is
  replaced, and a one-time `config.toml.herdr-usage.bak` keeps the original.
- Windows Terminal: the logo is added only when `HerdrUsageIcons` is in a Windows
  Terminal font face (read only); otherwise the setup prints a hint.
- Undo: the `uninstall` action removes everything except the inert `hook.js`, and
  writes a `disabled` file, so a later update does not set up again until you run the
  `setup` action. It works on a `config.toml` that herdr would reject. Only the lines
  the setup generated are removed; a damaged block (a lost marker line) or rows set with
  a dotted key stop the edit with a hint.
- `min_herdr_version` is now 0.9.3 (the setup uses `herdr config check`).
- Hooks now call a launcher, `<herdr config dir>/plugins/config/herdr-usage/hook.js`,
  which exits quietly when the plugin is gone. Old `node ".../src/cli.js"` hooks are
  repointed by the next setup and still removed by uninstall.
- Logo colors moved to `assets/icons.json` (`color`).
- Actions: `setup` and `uninstall` replace `install-hooks`, `uninstall-hooks`,
  `install-font` and `uninstall-font`. The CLI commands `install`, `install-font` and
  `uninstall-font` are folded into `setup` and `uninstall`. Run
  `herdr plugin action invoke herdr-usage.uninstall` before `herdr plugin uninstall`.

- Docs: describe herdr-usage as a provider-based plugin. README lists the supported
  providers (Claude Code, Codex) in one table, and the manifest and package
  descriptions are provider-neutral.

## 0.2.1 - 2026-10-05

- Logos: Claude starburst (`assets/claude-color.svg`) and the Codex cloud without its
  white tile (`assets/codex-color.svg`), both the same size and centered in one
  terminal cell (they used to sit high and spill into the next cell).
- README: no logo images.
- Font is installed under a content-hashed file name, so an update never fails on a
  file the terminal keeps locked.
- README: put `$herdr_usage_icon` in front of `agent`, so the usage row is not cut off.
- Font is now TrueType (`HerdrUsageIcons.ttf`); on Windows `install-font` also loads it
  and broadcasts the font change, like Explorer "Install". It removes the 0.2.0 `.otf`.
- README: Windows Terminal needs `HerdrUsageIcons` in its font list, otherwise it
  shows `?`.
- Internal: one provider contract (`src/providers/`) for reading usage, install and
  hook commands; logos listed in `assets/icons.json`. A new agent provider is one new
  module. Installed hook commands are unchanged.

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
