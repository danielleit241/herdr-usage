// Codex CLI adapter.
//
// Source: Codex rollout files `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`.
// Each `token_count` event carries the account-wide
// `rate_limits.{primary,secondary}` = `{ used_percent, window_minutes, resets_at }`.
// The newest event across all sessions is the current account state.

const fs = require("node:fs");
const path = require("node:path");
const paths = require("../paths");
const { command, isOurs, readJson, editJson } = require("../config-files");
const { unavailable, windowLabel, toWindow } = require("../usage");

const TAIL_BYTES = 512 * 1024;
const DAY_DIRS = 7; // a long session keeps writing to the folder of the day it started
const MAX_READS = 3;
const MAIN_LIMIT_ID = "codex";

function subdirsNewestFirst(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

// Rollout files of the newest day directories (sessions/YYYY/MM/DD), newest first.
function recentRollouts(sessionsDir) {
  const days = [];
  for (const year of subdirsNewestFirst(sessionsDir)) {
    for (const month of subdirsNewestFirst(year)) {
      for (const day of subdirsNewestFirst(month)) {
        days.push(day);
        if (days.length === DAY_DIRS) break;
      }
      if (days.length === DAY_DIRS) break;
    }
    if (days.length === DAY_DIRS) break;
  }
  const files = days.flatMap((day) =>
    fs.readdirSync(day)
      .filter((name) => name.startsWith("rollout-") && name.endsWith(".jsonl"))
      .map((name) => {
        const full = path.join(day, name);
        return { full, mtimeMs: fs.statSync(full).mtimeMs };
      }),
  );
  return files.sort((x, y) => y.mtimeMs - x.mtimeMs).map((f) => f.full);
}

function readTail(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

// Last main-bucket `rate_limits` object in a rollout tail, with the line's timestamp.
function lastRateLimits(text) {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"rate_limits"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // first line of a tail may be cut
    }
    const rl = entry && entry.payload && entry.payload.rate_limits;
    // Other buckets (e.g. "premium") have their own limits; show the main one.
    if (rl && (rl.limit_id == null || rl.limit_id === MAIN_LIMIT_ID) && (rl.primary || rl.secondary)) {
      const ts = Date.parse(entry.timestamp);
      return { rateLimits: rl, observedAt: Number.isNaN(ts) ? null : Math.floor(ts / 1000) };
    }
  }
  return null;
}

function normalize(found) {
  const windows = ["primary", "secondary"]
    .map((key) => found.rateLimits[key])
    .filter((w) => w && typeof w.window_minutes === "number")
    .map((w) => toWindow(windowLabel(w.window_minutes), w.used_percent, w.resets_at))
    .filter(Boolean);
  if (windows.length === 0) return unavailable("codex", "rate_limits has no windows");
  return { provider: "codex", status: "ok", windows, observedAt: found.observedAt };
}

function readSessions(codexHomeDir) {
  try {
    for (const file of recentRollouts(path.join(codexHomeDir, "sessions")).slice(0, MAX_READS)) {
      const found = lastRateLimits(readTail(file));
      if (found) return normalize(found);
    }
    return unavailable("codex", "no rate_limits in recent sessions");
  } catch (err) {
    return unavailable("codex", err.message);
  }
}

// --- install -------------------------------------------------------------

function hooksPath(env = process.env) {
  return path.join(paths.codexHome(env), "hooks.json");
}

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

function installHook(file, env) {
  const config = readJson(file, {});
  const stop = stopGroups(config, file);
  const next = [...withoutOurs(stop), { hooks: [{ type: "command", command: command("codex-hook", env), timeout: 10 }] }];
  if (JSON.stringify(next) === JSON.stringify(stop)) return `codex: already installed (${file})`;
  editJson(file, { ...config, hooks: { ...(config.hooks || {}), Stop: next } });
  return `codex: Stop hook installed (${file})`;
}

// The note also follows an error: a broken hooks.json and disabled hooks often come together.
function install(env = process.env) {
  const note = codexHooksNote(env);
  let line;
  try {
    line = installHook(hooksPath(env), env);
  } catch (err) {
    line = `codex: error: ${err.message}`;
  }
  return note ? [line, note] : [line];
}

function uninstall(env = process.env) {
  const file = hooksPath(env);
  const config = readJson(file, {});
  const stop = stopGroups(config, file);
  const kept = withoutOurs(stop);
  if (JSON.stringify(kept) === JSON.stringify(stop)) return ["codex: not installed"];
  const hooks = { ...config.hooks, Stop: kept };
  if (kept.length === 0) delete hooks.Stop;
  editJson(file, { ...config, hooks });
  return [`codex: Stop hook removed (${file})`];
}

module.exports = {
  id: "codex",
  configDir: (env = process.env) => paths.codexHome(env),
  read: (env) => readSessions(paths.codexHome(env)),
  install,
  uninstall,
  hooks: { "codex-hook": (input, ctx) => ctx.publish() },
  recentRollouts,
  lastRateLimits,
  normalize,
  readSessions,
};
