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

function claudeCachePath(env = process.env) {
  return path.join(stateDir(env), "claude-rate-limits.json");
}

function codexHome(env = process.env) {
  return env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

module.exports = { PLUGIN_ID, stateDir, claudeCachePath, codexHome };
