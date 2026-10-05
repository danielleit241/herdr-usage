#!/usr/bin/env node
// herdr-usage entry point.
//
//   status             print the normalized usage state of every provider (JSON)
//   publish            push usage to herdr agent panes
//   install            wire every provider's tool to refresh usage
//   uninstall          undo `install`
//   install-font       install the logo font for the current user
//   uninstall-font     undo `install-font`
//   <hook>             commands the tools run, listed by each provider (src/providers)
//
// Hook commands never fail the calling agent: they always exit 0.

const fs = require("node:fs");
const path = require("node:path");
const paths = require("./paths");
const providers = require("./providers");
const herdr = require("./herdr");
const installer = require("./install");
const font = require("./font");
const { readJson } = require("./config-files");
const { windowTokens } = require("./usage");

const STATUSLINE_PUBLISH_INTERVAL_MS = 15_000;
const COMMANDS = ["status", "publish", "install", "uninstall", "install-font", "uninstall-font"];

function readStates(env = process.env) {
  return providers.readAll(env);
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
  const last = readJson(lastPublishPath(), null);
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

// What a provider hook can do. publish does nothing outside herdr. `now` is a
// function: a chained statusLine may run for seconds before the hook caches.
function hookContext(env) {
  return {
    env,
    now: () => Date.now(),
    write: (text) => process.stdout.write(text),
    publish({ throttle = false } = {}) {
      if (!inHerdr(env)) return;
      const now = Date.now();
      const states = readStates(env);
      if (throttle && !publishDue(signature(states, Math.floor(now / 1000)), now)) return;
      publishAndRecord(states, now);
    },
  };
}

function runHook(handler, env = process.env) {
  const input = readStdin();
  try {
    handler(input, hookContext(env));
  } catch {
    // degrade silently: a hook must not break the calling agent
  }
}

function main(command) {
  const hooks = providers.hookHandlers();
  if (Object.hasOwn(hooks, command)) {
    runHook(hooks[command]);
    return;
  }
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
      process.stderr.write(`usage: herdr-usage <${[...COMMANDS, ...Object.keys(hooks)].join("|")}>\n`);
      process.exitCode = 2;
  }
}

if (require.main === module) main(process.argv[2]);

module.exports = { COMMANDS, readStates, signature, publishDue, publishAndRecord };
