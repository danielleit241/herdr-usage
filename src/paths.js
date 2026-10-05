const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");

const PLUGIN_ID = "herdr-usage";

// Mirrors herdr's plugin_state_dir(): the statusLine command runs outside
// herdr's plugin environment, so it must resolve the same directory itself.
function stateDir(env = process.env) {
  if (env.HERDR_PLUGIN_STATE_DIR) return env.HERDR_PLUGIN_STATE_DIR;
  let base;
  if (env.XDG_STATE_HOME) base = path.join(env.XDG_STATE_HOME, "herdr");
  else if (process.platform === "win32" && env.LOCALAPPDATA) base = path.join(env.LOCALAPPDATA, "herdr");
  else if (process.platform === "win32" && env.USERPROFILE) base = path.join(env.USERPROFILE, "AppData", "Local", "herdr");
  else base = path.join(os.homedir(), ".local", "state", "herdr");
  return path.join(base, "plugins", PLUGIN_ID);
}

// Mirrors herdr's config dir: $XDG_CONFIG_HOME/herdr, else %APPDATA%\herdr on
// Windows, else ~/.config/herdr.
function herdrConfigDir(env = process.env, platform = process.platform) {
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, "herdr");
  if (platform === "win32") {
    const home = env.USERPROFILE || os.homedir();
    return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "herdr");
  }
  return path.join(env.HOME || os.homedir(), ".config", "herdr");
}

function herdrConfigFile(env = process.env, platform = process.platform) {
  return env.HERDR_CONFIG_PATH || path.join(herdrConfigDir(env, platform), "config.toml");
}

// Where herdr keeps the installed plugin: github/<id>-<first 12 hex of sha256(id)>.
// `setup` runs in a temporary checkout, before herdr moves it here.
function managedCheckout(env = process.env, platform = process.platform) {
  const hash = crypto.createHash("sha256").update(PLUGIN_ID).digest("hex").slice(0, 12);
  return path.join(herdrConfigDir(env, platform), "plugins", "github", `${PLUGIN_ID}-${hash}`);
}

// Holds hook.js. herdr keeps this dir after `herdr plugin uninstall`.
function pluginConfigDir(env = process.env, platform = process.platform) {
  return path.join(herdrConfigDir(env, platform), "plugins", "config", PLUGIN_ID);
}

function claudeCachePath(env = process.env) {
  return path.join(stateDir(env), "claude-rate-limits.json");
}

function codexHome(env = process.env) {
  return env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

module.exports = {
  PLUGIN_ID,
  stateDir,
  herdrConfigDir,
  herdrConfigFile,
  managedCheckout,
  pluginConfigDir,
  claudeCachePath,
  codexHome,
};
