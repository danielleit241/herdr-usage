// Provider-neutral usage state shared by every adapter.
//
// UsageState = {
//   provider: string,             // herdr agent id, see src/providers/index.js
//   status: "ok" | "unavailable",
//   windows: [{ label: "5h" | "wk" | ..., usedPercent: number, resetsAt: epochSeconds | null }],
//   observedAt: epochSeconds | null,
//   reason?: string,              // why the provider is unavailable
// }

const MAX_TTL_MS = 86_400_000;

function unavailable(provider, reason) {
  return { provider, status: "unavailable", windows: [], observedAt: null, reason };
}

function windowLabel(minutes) {
  if (minutes === 300) return "5h";
  if (minutes === 10080) return "wk";
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function toWindow(label, usedPercent, resetsAt) {
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent)) return null;
  const resets = typeof resetsAt === "number" && Number.isFinite(resetsAt) ? resetsAt : null;
  return { label, usedPercent, resetsAt: resets };
}

// Level glyph first, so herdr style rules (`starts_with`) can color each
// window by level; the glyph's fill also shows the level without color.
function levelGlyph(usedPercent) {
  if (usedPercent >= 80) return "●";
  if (usedPercent >= 50) return "◐";
  return "○";
}

// One sidebar token per window slot, e.g. "◐ wk 55%", expiring when the window
// resets. A slot is null when the window is unknown or has already reset.
function windowTokens(state, nowSec, slots = 2) {
  return Array.from({ length: slots }, (_, i) => {
    const w = state.status === "ok" ? state.windows[i] : undefined;
    if (!w || (w.resetsAt !== null && w.resetsAt <= nowSec)) return null;
    const pct = Math.round(w.usedPercent);
    const ttlMs = w.resetsAt === null ? MAX_TTL_MS : Math.min(MAX_TTL_MS, Math.ceil((w.resetsAt - nowSec) * 1000));
    return { value: `${levelGlyph(pct)} ${w.label} ${pct}%`, ttlMs };
  });
}

module.exports = { unavailable, windowLabel, toWindow, levelGlyph, windowTokens };
