// Claude Code adapter.
//
// Source: the documented statusLine stdin JSON (`rate_limits.five_hour` /
// `rate_limits.seven_day`, each `{ used_percentage, resets_at }`). Claude Code
// only sends it to Pro/Max sessions after the first API response, so the
// statusLine command merges what it sees into a cache and this adapter reads it.

const fs = require("node:fs");
const path = require("node:path");
const { unavailable, toWindow } = require("../usage");

const WINDOWS = [
  ["five_hour", "5h"],
  ["seven_day", "wk"],
];
const SAME_WINDOW_SEC = 60;

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

function read(cachePath) {
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

module.exports = { newerWindow, cacheFromStatusLine, read };
