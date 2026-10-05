#!/usr/bin/env node
// herdr-usage entry point.
//
//   status             print the normalized usage state of every provider (JSON)
//   publish            push usage to herdr agent panes
//   claude-statusline  Claude Code statusLine command: cache rate_limits, then publish (throttled)
//   codex-hook         Codex Stop hook: publish
//   install            wire the Claude statusLine and the Codex Stop hook
//   uninstall          undo `install`
//
// Hook commands never fail the calling agent: they always exit 0. The statusLine
// prints only the output of a statusLine it chained at install time.

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const paths = require("./paths");
const claude = require("./providers/claude");
const codex = require("./providers/codex");
const herdr = require("./herdr");
const installer = require("./install");

const STATUSLINE_PUBLISH_INTERVAL_MS = 15_000;

function readStates(env = process.env) {
  return [claude.read(paths.claudeCachePath(env)), codex.read(paths.codexHome(env))];
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function inHerdr(env = process.env) {
  return env.HERDR_ENV === "1";
}

// statusLine fires many times per turn; publish at most once per interval.
function claimPublishSlot(now) {
  const stamp = path.join(paths.stateDir(), "last-statusline-publish");
  try {
    if (now - fs.statSync(stamp).mtimeMs < STATUSLINE_PUBLISH_INTERVAL_MS) return false;
  } catch {
    // no stamp yet
  }
  fs.mkdirSync(path.dirname(stamp), { recursive: true });
  fs.writeFileSync(stamp, "");
  return true;
}

// The shell Claude Code runs statusLine commands with: Git Bash on Windows
// (PowerShell without it), the user's shell elsewhere.
function statusLineShell(env = process.env) {
  for (const candidate of [env.CLAUDE_CODE_GIT_BASH_PATH, env.SHELL]) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return process.platform === "win32" ? "powershell.exe" : "/bin/sh";
}

// Run the user's previous statusLine, if `install` chained one, and return its output.
function chainedStatusLine(input) {
  const chained = installer.readJson(installer.chainPath(), null);
  if (!chained || !chained.command) return "";
  try {
    return execSync(chained.command, {
      input,
      encoding: "utf8",
      shell: statusLineShell(),
      timeout: 5000,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

function main(command) {
  switch (command) {
    case "status":
      process.stdout.write(`${JSON.stringify(readStates(), null, 2)}\n`);
      return;
    case "publish": {
      const { updated, failed } = herdr.publish(readStates());
      process.stdout.write(`updated ${updated} pane(s)\n`);
      for (const message of failed) process.stderr.write(`failed: ${message}\n`);
      if (failed.length) process.exitCode = 1;
      return;
    }
    case "claude-statusline": {
      const input = readStdin();
      // Print first: Claude Code cancels a statusLine that is still running.
      process.stdout.write(chainedStatusLine(input));
      try {
        const now = Date.now();
        claude.cacheFromStatusLine(JSON.parse(input), paths.claudeCachePath(), Math.floor(now / 1000));
        if (inHerdr() && claimPublishSlot(now)) herdr.publish(readStates());
      } catch {
        // degrade silently: the statusLine must keep working
      }
      return;
    }
    case "codex-hook":
      readStdin();
      try {
        if (inHerdr()) herdr.publish(readStates());
      } catch {
        // degrade silently: the hook must not block Codex
      }
      return;
    case "install":
    case "uninstall":
      for (const line of installer[command]()) process.stdout.write(`${line}\n`);
      return;
    default:
      process.stderr.write("usage: herdr-usage <status|publish|install|uninstall|claude-statusline|codex-hook>\n");
      process.exitCode = 2;
  }
}

if (require.main === module) main(process.argv[2]);

module.exports = { readStates, statusLineShell };
