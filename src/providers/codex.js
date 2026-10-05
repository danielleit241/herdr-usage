// Codex CLI adapter.
//
// Source: Codex rollout files `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl`.
// Each `token_count` event carries the account-wide
// `rate_limits.{primary,secondary}` = `{ used_percent, window_minutes, resets_at }`.
// The newest event across all sessions is the current account state.

const fs = require("node:fs");
const path = require("node:path");
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

function read(codexHomeDir) {
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

module.exports = { recentRollouts, lastRateLimits, normalize, read };
