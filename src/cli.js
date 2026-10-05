#!/usr/bin/env node
// herdr-usage entry point.
//
//   status             print the normalized usage state of every provider (JSON)
//   publish            push usage to herdr agent panes
//   claude-statusline  Claude Code statusLine command: cache rate_limits, then publish (throttled)
//   codex-hook         Codex Stop hook: publish
//   install            wire the Claude statusLine and the Codex Stop hook
//   uninstall          undo `install`
//   install-font       install the logo font for the current user
//   uninstall-font     undo `install-font`
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
const font = require("./font");
const { windowTokens } = require("./usage");

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

// What the sidebar should show, used to skip publishes that change nothing.
function signature(states, nowSec) {
  return JSON.stringify(states.map((s) => windowTokens(s, nowSec).map((t) => t && t.value)));
}

function lastPublishPath() {
  return path.join(paths.stateDir(), "last-publish.json");
}

// statusLine fires many times per turn. Publish when the numbers changed, and
// otherwise at most once per interval (that also moves the usage row when the
// owner pane changes).
function publishDue(sig, now) {
  const last = installer.readJson(lastPublishPath(), null);
  return !last || last.signature !== sig || now - last.at >= STATUSLINE_PUBLISH_INTERVAL_MS;
}

// Publishes and records it only on success, so a cancelled or failed publish
// is retried on the next statusLine run.
function publishAndRecord(states, now) {
  const sig = signature(states, Math.floor(now / 1000));
  const { failed } = herdr.publish(states);
  if (failed.length === 0) {
    fs.mkdirSync(paths.stateDir(), { recursive: true });
    fs.writeFileSync(lastPublishPath(), JSON.stringify({ signature: sig, at: now }));
  }
}

// The shell Claude Code runs statusLine commands with: `sh -c` on macOS and
// Linux; Git Bash on Windows, or PowerShell when Git Bash is missing.
function statusLineShell(env = process.env, platform = process.platform) {
  if (platform !== "win32") return "/bin/sh";
  for (const candidate of [env.CLAUDE_CODE_GIT_BASH_PATH, env.SHELL]) {
    if (candidate && /bash(\.exe)?$/i.test(candidate) && fs.existsSync(candidate)) return candidate;
  }
  return "powershell.exe";
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
      timeout: 10_000,
      windowsHide: true,
      stdio: ["pipe", "pipe", "inherit"],
    });
  } catch (err) {
    // A script may print its line and still exit non-zero.
    return typeof err.stdout === "string" ? err.stdout : "";
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
        if (inHerdr()) {
          const states = readStates();
          if (publishDue(signature(states, Math.floor(now / 1000)), now)) publishAndRecord(states, now);
        }
      } catch {
        // degrade silently: the statusLine must keep working
      }
      return;
    }
    case "codex-hook":
      readStdin();
      try {
        if (inHerdr()) publishAndRecord(readStates(), Date.now());
      } catch {
        // degrade silently: the hook must not block Codex
      }
      return;
    case "install":
    case "uninstall":
      for (const line of installer[command]()) process.stdout.write(`${line}\n`);
      return;
    case "install-font":
      for (const line of font.installFont()) process.stdout.write(`${line}\n`);
      return;
    case "uninstall-font":
      for (const line of font.uninstallFont()) process.stdout.write(`${line}\n`);
      return;
    default:
      process.stderr.write("usage: herdr-usage <status|publish|install|uninstall|install-font|uninstall-font|claude-statusline|codex-hook>\n");
      process.exitCode = 2;
  }
}

if (require.main === module) main(process.argv[2]);

module.exports = { readStates, statusLineShell, signature, publishDue, chainedStatusLine };
