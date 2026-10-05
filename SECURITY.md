# Security policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub private vulnerability reporting](https://github.com/danielleit241/herdr-usage/security/advisories/new).
Do not open a public issue. You should get an answer within 7 days.

## Scope

herdr-usage runs as your user, like every herdr plugin. Relevant reports include:

- reading or exposing data beyond the `rate_limits` fields described in the README;
- corrupting or losing content in a config file that the setup edits (today
  `~/.claude/settings.json`, `~/.codex/hooks.json` and herdr's `config.toml`);
- command injection through usage data, file paths or hook configuration.

Issues in herdr itself belong to [herdrdev/herdr](https://github.com/herdrdev/herdr).
