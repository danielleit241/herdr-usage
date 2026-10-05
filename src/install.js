// Wires herdr-usage into Claude Code (statusLine) and Codex (Stop hook).
//
// Both edits are idempotent, keep the original file as *.herdr-usage.bak, and
// keep foreign configuration: an existing Claude statusLine is chained, not
// replaced, and other Codex hooks are left untouched.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const paths = require("./paths");

const CLI = path.resolve(__dirname, "cli.js").replace(/\\/g, "/");
const command = (sub) => `node "${CLI}" ${sub}`;
// Ours: `node "<plugin root>/src/cli.js" <sub>`, from this or another plugin directory.
const isOurs = (cmd, sub) =>
  typeof cmd === "string" && /^node ".*[\\/]src[\\/]cli\.js" /.test(cmd) && cmd.trimEnd().endsWith(` ${sub}`);

function claudeSettingsPath(env = process.env) {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "settings.json");
}

function codexHooksPath(env = process.env) {
  return path.join(paths.codexHome(env), "hooks.json");
}

function chainPath(env = process.env) {
  return path.join(paths.stateDir(env), "claude-statusline-chain.json");
}

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

// --- Claude Code ---------------------------------------------------------

function installClaude(env = process.env) {
  const file = claudeSettingsPath(env);
  const settings = readJson(file, {});
  const current = settings.statusLine;
  const wanted = command("claude-statusline");
  if (current && current.command === wanted) return `claude: already installed (${file})`;
  if (current && isOurs(current.command, "claude-statusline")) {
    // An install from another plugin directory: repoint it, keep the chained statusLine.
  } else if (current && current.type === "command" && current.command && current.command.trim()) {
    writeJson(chainPath(env), { command: current.command });
  } else {
    fs.rmSync(chainPath(env), { force: true });
  }
  editJson(file, { ...settings, statusLine: { ...(current || {}), type: "command", command: wanted } });
  return `claude: statusLine installed (${file})`;
}

function uninstallClaude(env = process.env) {
  const file = claudeSettingsPath(env);
  const settings = readJson(file, {});
  if (!settings.statusLine || !isOurs(settings.statusLine.command, "claude-statusline")) {
    return "claude: not installed";
  }
  const chained = readJson(chainPath(env), null);
  const next = { ...settings };
  if (chained && chained.command) next.statusLine = { ...settings.statusLine, command: chained.command };
  else delete next.statusLine;
  editJson(file, next);
  fs.rmSync(chainPath(env), { force: true });
  return `claude: statusLine restored (${file})`;
}

// --- Codex ---------------------------------------------------------------

function stopGroups(config, file) {
  const stop = config.hooks?.Stop ?? [];
  if (!Array.isArray(stop)) throw new Error(`cannot parse ${file}: hooks.Stop is not an array`);
  return stop;
}

// Stop groups without any herdr-usage hook (from this or another plugin directory).
function withoutOurs(stop) {
  const ours = (h) => isOurs(h && h.command, "codex-hook");
  const hasOurs = (group) => Array.isArray(group.hooks) && group.hooks.some(ours);
  return stop
    .filter((group) => !(hasOurs(group) && group.hooks.every(ours)))
    .map((group) => (hasOurs(group) ? { ...group, hooks: group.hooks.filter((h) => !ours(h)) } : group));
}

// Codex runs hooks.json only with `[features] hooks = true` in config.toml.
function codexHooksNote(env) {
  let toml = "";
  try {
    toml = fs.readFileSync(path.join(paths.codexHome(env), "config.toml"), "utf8");
  } catch {
    // no config.toml
  }
  return /^\[features\][^[]*^\s*hooks\s*=\s*true/m.test(toml)
    ? null
    : "codex: note: enable hooks with `[features] hooks = true` in config.toml";
}

function installCodex(env = process.env) {
  const file = codexHooksPath(env);
  const config = readJson(file, {});
  const stop = stopGroups(config, file);
  const next = [...withoutOurs(stop), { hooks: [{ type: "command", command: command("codex-hook"), timeout: 10 }] }];
  if (JSON.stringify(next) === JSON.stringify(stop)) return `codex: already installed (${file})`;
  editJson(file, { ...config, hooks: { ...(config.hooks || {}), Stop: next } });
  return `codex: Stop hook installed (${file})`;
}

function uninstallCodex(env = process.env) {
  const file = codexHooksPath(env);
  const config = readJson(file, {});
  const stop = stopGroups(config, file);
  const kept = withoutOurs(stop);
  if (JSON.stringify(kept) === JSON.stringify(stop)) return "codex: not installed";
  const hooks = { ...config.hooks, Stop: kept };
  if (kept.length === 0) delete hooks.Stop;
  editJson(file, { ...config, hooks });
  return `codex: Stop hook removed (${file})`;
}

// Runs each step on its own: one tool's broken config does not block the other,
// and a tool that is not installed is skipped instead of getting a new config.
function runSteps(steps) {
  return steps.map(([name, configDir, step]) => {
    if (!fs.existsSync(configDir)) return `${name}: skipped (${configDir} not found)`;
    try {
      return step();
    } catch (err) {
      return `${name}: error: ${err.message}`;
    }
  });
}

function install(env = process.env) {
  const codexDir = paths.codexHome(env);
  const lines = runSteps([
    ["claude", path.dirname(claudeSettingsPath(env)), () => installClaude(env)],
    ["codex", codexDir, () => installCodex(env)],
  ]);
  const note = fs.existsSync(codexDir) && codexHooksNote(env);
  return note ? [...lines, note] : lines;
}

function uninstall(env = process.env) {
  return runSteps([
    ["claude", path.dirname(claudeSettingsPath(env)), () => uninstallClaude(env)],
    ["codex", paths.codexHome(env), () => uninstallCodex(env)],
  ]);
}

module.exports = { install, uninstall, chainPath, readJson };
