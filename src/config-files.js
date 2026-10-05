// Helpers to read and edit the JSON config files of the tools herdr-usage wires into.

const fs = require("node:fs");
const path = require("node:path");

const CLI = path.resolve(__dirname, "cli.js").replace(/\\/g, "/");
const command = (sub) => `node "${CLI}" ${sub}`;
// Ours: `node "<plugin root>/src/cli.js" <sub>`, from this or another plugin directory.
const isOurs = (cmd, sub) =>
  typeof cmd === "string" && /^node ".*[\\/]src[\\/]cli\.js" /.test(cmd) && cmd.trimEnd().endsWith(` ${sub}`);

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
