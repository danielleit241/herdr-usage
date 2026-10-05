// `setup` and `uninstall`: everything the plugin changes outside its own checkout.
// Each step runs on its own, so one failure never stops the others.
//
//   setup      font -> launcher (hook.js) -> provider hooks -> herdr sidebar rows
//              -> reload herdr -> publish once
//   uninstall  provider hooks -> herdr sidebar rows -> reload herdr -> font

const fs = require("node:fs");
const path = require("node:path");
const font = require("./font");
const herdr = require("./herdr");
const herdrConfig = require("./herdr-config");
const installer = require("./install");
const launcher = require("./launcher");
const paths = require("./paths");
const providers = require("./providers");
const { run } = require("./exec");

// herdr discards the output of a build step that succeeds, so the full report also
// goes to setup.log, and the install run sends a short notification.
const ATTENTION = /: error: |not edited|damaged|could not|skipped \(launcher|by hand/;

const logPath = (env) => path.join(paths.pluginConfigDir(env), "setup.log");
// `uninstall` writes this file. A later update (its build step) then leaves the
// machine alone until the user runs the setup action again.
const disabledPath = (env) => path.join(paths.pluginConfigDir(env), "disabled");

function writeLog(env, lines) {
  try {
    fs.mkdirSync(path.dirname(logPath(env)), { recursive: true });
    fs.writeFileSync(logPath(env), `${lines.join("\n")}\n`);
  } catch {
    // the log is a convenience
  }
}

// Appends the lines of fn() to `lines`, or `<area>: error: ...` when it throws.
// fn may return { lines, changed } (a config edit) or an array.
function step(lines, area, fn) {
  try {
    const out = fn();
    lines.push(...(Array.isArray(out) ? out : out.lines));
    return { ok: true, changed: !Array.isArray(out) && out.changed };
  } catch (err) {
    lines.push(`${area}: error: ${err.message}`);
    return { ok: false, changed: false };
  }
}

function defaultPublish(env) {
  herdr.publish(providers.readAll(env), env);
}

function notify(env, exec, lines, restart) {
  const ids = providers.PROVIDERS.map((p) => p.id).filter((id) =>
    lines.some((l) => l.startsWith(`${id}: `) && /installed/.test(l)),
  );
  const body = lines.some((l) => ATTENTION.test(l))
    ? "Setup needs attention: run `herdr plugin action invoke herdr-usage.setup` to see what to do."
    : `${ids.length ? `Set up for ${ids.join(", ")}.` : "Set up, but no supported agent tool was found."}${
        restart ? " Fully restart your terminal to see the logos." : ""
      }`;
  try {
    exec(herdr.herdrBin(env), ["notification", "show", "herdr-usage", "--body", body]);
  } catch {
    // best effort: the report is in setup.log
  }
}

// build: running as herdr's install build step, from a temporary checkout.
// exec and publish are injected by tests.
function setup(env = process.env, { build = false, platform = process.platform, exec = run, publish = defaultPublish } = {}) {
  if (build && fs.existsSync(disabledPath(env))) {
    const skipped = ["setup skipped: run the herdr-usage.setup action to enable again"];
    writeLog(env, skipped);
    return skipped;
  }
  const lines = [];
  if (!build) {
    // Re-enables updates. Isolated: on Linux a broken config dir throws ENOTDIR here.
    step(lines, "setup", () => {
      fs.rmSync(disabledPath(env), { force: true });
      return [];
    });
  }
  step(lines, "font", () => font.installFont(env, platform, exec));
  const launcherStep = step(lines, "launcher", () => launcher.writeHook(env, { build }));
  if (launcherStep.ok) step(lines, "hooks", () => installer.install(env));
  else lines.push("hooks: skipped (launcher not written)");
  if (step(lines, "herdr", () => herdrConfig.setupRows(env, { exec, platform })).changed) herdrConfig.reloadConfig(env, exec);
  try {
    publish(env);
  } catch {
    // optional: herdr may not run, or the agents have no data yet
  }
  const restart = lines.indexOf(font.RESTART);
  if (restart >= 0) {
    lines.splice(restart, 1);
    lines.push(font.RESTART);
  }
  writeLog(env, lines);
  if (build) notify(env, exec, lines, restart >= 0);
  return lines;
}

// hook.js stays: it is inert once the hooks are gone, and the next setup reuses it.
function uninstall(env = process.env, { platform = process.platform, exec = run } = {}) {
  const lines = [];
  step(lines, "hooks", () => installer.uninstall(env));
  if (step(lines, "herdr", () => herdrConfig.removeRows(env, { exec, platform })).changed) herdrConfig.reloadConfig(env, exec);
  step(lines, "font", () => font.uninstallFont(env, platform, exec));
  step(lines, "disable", () => {
    fs.mkdirSync(path.dirname(disabledPath(env)), { recursive: true });
    fs.writeFileSync(disabledPath(env), "herdr-usage setup was undone; run the herdr-usage.setup action to enable it again\n");
    return ["setup: disabled until you run the herdr-usage.setup action"];
  });
  return lines;
}

module.exports = { setup, uninstall, logPath, disabledPath };
