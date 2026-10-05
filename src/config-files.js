// Helpers to read and edit the JSON config files of the tools herdr-usage wires into.

const fs = require("node:fs");
const path = require("node:path");
const { hookPath } = require("./launcher");

// Tools run the launcher in the plugin config dir (src/launcher.js), not the plugin
// checkout: that dir survives an update, and the launcher exits quietly once the
// plugin is uninstalled.
const command = (sub, env = process.env) => `node "${hookPath(env).replace(/\\/g, "/")}" ${sub}`;
// Ours: the launcher form `node ".../herdr-usage/hook.js" <sub>`, or the form of
// 0.2.x, `node "<plugin root>/src/cli.js" <sub>`, from any plugin directory.
const isOurs = (cmd, sub) =>
  typeof cmd === "string" &&
  /^node ".*[\\/](src[\\/]cli\.js|herdr-usage[\\/]hook\.js)" /.test(cmd) &&
  cmd.trimEnd().endsWith(` ${sub}`);

function readJson(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
  try {
    // Windows editors often save a UTF-8 BOM.
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (err) {
    throw new Error(`cannot parse ${file}: ${err.message}`);
  }
}

// Atomic write next to the real file, so a symlinked dotfile stays a symlink
// and an interrupted write never leaves a truncated config.
function writeJson(file, value) {
  let target = file;
  try {
    target = fs.realpathSync(file);
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}
`);
  fs.renameSync(tmp, target);
}

// Edits a user config file. The first edit keeps the original as *.herdr-usage.bak.
function editJson(file, value) {
  const backup = `${file}.herdr-usage.bak`;
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  writeJson(file, value);
}

module.exports = { command, isOurs, readJson, writeJson, editJson };
