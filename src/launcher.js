// The hook launcher: <plugin config dir>/hook.js. Claude Code and Codex run
// `node ".../hook.js" <hook name>`, and it forwards to this plugin's cli.js.
// It hides where the plugin lives (updates and `herdr plugin link` move it), and
// it exits 0 without output when the plugin is gone, so a hook left behind by
// `herdr plugin uninstall` never breaks an agent tool.

const fs = require("node:fs");
const path = require("node:path");
const paths = require("./paths");

const hookPath = (env = process.env) => path.join(paths.pluginConfigDir(env), "hook.js");

function hookSource(target) {
  return `// herdr-usage hook launcher, written by \`herdr-usage setup\`. Safe to delete.
const fs = require("node:fs");
const target = ${JSON.stringify(target)};
try {
  if (fs.existsSync(target)) require(target).main(process.argv[2]);
} catch {
  // a hook must never break the calling agent
}
`;
}

// build: running from herdr's temporary checkout, so point at the final managed
// checkout. Otherwise this code is the installed (or linked) plugin.
function writeHook(env = process.env, { build = false } = {}) {
  const target = build ? path.join(paths.managedCheckout(env), "src", "cli.js") : path.resolve(__dirname, "cli.js");
  const file = hookPath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, hookSource(target));
  fs.renameSync(tmp, file);
  return [`launcher: wrote ${file}`];
}

// Self-heal: when hook.js points at a plugin directory that is gone (the plugin was
// moved or relinked), point it at this code. Returns whether it rewrote the file.
function healHook(env = process.env) {
  let source;
  try {
    source = fs.readFileSync(hookPath(env), "utf8");
  } catch {
    return false; // no launcher: the setup was never run, or the user removed it
  }
  const match = /^const target = (".*");$/m.exec(source);
  if (!match || fs.existsSync(JSON.parse(match[1]))) return false;
  writeHook(env);
  return true;
}

module.exports = { hookPath, hookSource, writeHook, healHook };
