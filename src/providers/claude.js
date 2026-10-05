// Claude Code adapter.
//
// Source: the documented statusLine stdin JSON (`rate_limits.five_hour` /
// `rate_limits.seven_day`, each `{ used_percentage, resets_at }`). Claude Code
// only sends it to Pro/Max sessions after the first API response, so the
// statusLine command merges what it sees into a cache and this adapter reads it.

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const paths = require("../paths");
const { command, isOurs, readJson, writeJson, editJson } = require("../config-files");
const { unavailable, toWindow } = require("../usage");

const WINDOWS = [
  ["five_hour", "5h"],
  ["seven_day", "wk"],
];
const SAME_WINDOW_SEC = 60;

function configDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

// Pick the newer reading of one window. Several Claude panes share the cache,
// and an idle pane re-sends its last (older) numbers: a later reset time means
// a newer window, and within one window usage only grows.
function newerWindow(cached, incoming) {
  if (!cached) return incoming;
  if (!incoming) return cached;
  // Reset times of one window may differ by a few seconds between reports.
  if (Math.abs(incoming.resets_at - cached.resets_at) > SAME_WINDOW_SEC) {
    return incoming.resets_at > cached.resets_at ? incoming : cached;
  }
  return incoming.used_percentage >= cached.used_percentage ? incoming : cached;
}

// statusLine side: merge rate_limits from one statusLine payload into the cache.
// Returns true when the cache was written.
function cacheFromStatusLine(payload, cachePath, nowSec) {
  const rateLimits = payload && payload.rate_limits;
  if (!rateLimits || typeof rateLimits !== "object") return false;
  if (!WINDOWS.some(([key]) => rateLimits[key])) return false;
  let previous = {};
  try {
    previous = JSON.parse(fs.readFileSync(cachePath, "utf8")).rate_limits || {};
  } catch {
    // no usable cache yet
  }
  const merged = {};
  for (const [key] of WINDOWS) {
    const w = newerWindow(previous[key], rateLimits[key]);
    if (w) merged[key] = w;
  }
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const tmp = `${cachePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ observed_at: nowSec, rate_limits: merged }));
  fs.renameSync(tmp, cachePath);
  return true;
}

function readCache(cachePath) {
  let cache;
  try {
    cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch (err) {
    return unavailable("claude", err.code === "ENOENT" ? "no statusLine data yet" : `bad cache: ${err.message}`);
  }
  const rateLimits = (cache && cache.rate_limits) || {};
  const windows = WINDOWS.map(([key, label]) => {
    const w = rateLimits[key];
    return w ? toWindow(label, w.used_percentage, w.resets_at) : null;
  }).filter(Boolean);
  if (windows.length === 0) return unavailable("claude", "no rate limit windows in cache");
  return { provider: "claude", status: "ok", windows, observedAt: cache.observed_at ?? null };
}

// --- install -------------------------------------------------------------

function settingsPath(env = process.env) {
  return path.join(configDir(env), "settings.json");
}

function chainPath(env = process.env) {
  return path.join(paths.stateDir(env), "claude-statusline-chain.json");
}

function install(env = process.env) {
  const file = settingsPath(env);
  const settings = readJson(file, {});
  const current = settings.statusLine;
  const wanted = command("claude-statusline");
  if (current && current.command === wanted) return [`claude: already installed (${file})`];
  if (current && isOurs(current.command, "claude-statusline")) {
    // An install from another plugin directory: repoint it, keep the chained statusLine.
  } else if (current && current.type === "command" && current.command && current.command.trim()) {
    writeJson(chainPath(env), { command: current.command });
  } else {
    fs.rmSync(chainPath(env), { force: true });
  }
  editJson(file, { ...settings, statusLine: { ...(current || {}), type: "command", command: wanted } });
  return [`claude: statusLine installed (${file})`];
}

function uninstall(env = process.env) {
  const file = settingsPath(env);
  const settings = readJson(file, {});
  if (!settings.statusLine || !isOurs(settings.statusLine.command, "claude-statusline")) {
    return ["claude: not installed"];
  }
  const chained = readJson(chainPath(env), null);
  const next = { ...settings };
  if (chained && chained.command) next.statusLine = { ...settings.statusLine, command: chained.command };
  else delete next.statusLine;
  editJson(file, next);
  fs.rmSync(chainPath(env), { force: true });
  return [`claude: statusLine restored (${file})`];
}

// --- hook ----------------------------------------------------------------

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
function chainedStatusLine(input, env = process.env) {
  const chained = readJson(chainPath(env), null);
  if (!chained || !chained.command) return "";
  try {
    return execSync(chained.command, {
      input,
      encoding: "utf8",
      shell: statusLineShell(env),
      timeout: 10_000,
      windowsHide: true,
      stdio: ["pipe", "pipe", "inherit"],
    });
  } catch (err) {
    // A script may print its line and still exit non-zero.
    return typeof err.stdout === "string" ? err.stdout : "";
  }
}

function statusLineHook(input, { env, now, write, publish }) {
  // Print first: Claude Code cancels a statusLine that is still running.
  write(chainedStatusLine(input, env));
  cacheFromStatusLine(JSON.parse(input), paths.claudeCachePath(env), Math.floor(now / 1000));
  publish({ throttle: true });
}

module.exports = {
  id: "claude",
  configDir,
  read: (env) => readCache(paths.claudeCachePath(env)),
  install,
  uninstall,
  hooks: { "claude-statusline": statusLineHook },
  newerWindow,
  cacheFromStatusLine,
  readCache,
  settingsPath,
  chainPath,
  statusLineShell,
  chainedStatusLine,
};
