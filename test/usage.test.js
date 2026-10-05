const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { windowTokens, windowLabel, levelGlyph } = require("../src/usage");
const claude = require("../src/providers/claude");
const codex = require("../src/providers/codex");
const { ICONS, planReports, reportCommands } = require("../src/herdr");

const NOW = 1_791_200_000;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "herdr-usage-"));

const ok = (provider, windows) => ({ provider, status: "ok", windows, observedAt: NOW });
const values = (state, now = NOW) => windowTokens(state, now).map((t) => t && t.value);

test("windowLabel maps codex window minutes", () => {
  assert.equal(windowLabel(300), "5h");
  assert.equal(windowLabel(10080), "wk");
  assert.equal(windowLabel(1440), "1d");
});

test("levelGlyph uses three levels: <50, 50-79, >=80", () => {
  assert.deepEqual([0, 49, 50, 79, 80, 100].map(levelGlyph), ["○", "○", "◐", "◐", "●", "●"]);
});

test("windowTokens renders one token per slot and drops reset windows", () => {
  const state = ok("codex", [
    { label: "5h", usedPercent: 34.4, resetsAt: NOW + 100 },
    { label: "wk", usedPercent: 85, resetsAt: NOW + 1000 },
  ]);
  assert.deepEqual(windowTokens(state, NOW), [
    { value: "○ 5h 34%", ttlMs: 100_000 },
    { value: "● wk 85%", ttlMs: 1_000_000 },
  ]);
  assert.deepEqual(values(state, NOW + 200), [null, "● wk 85%"]);
  assert.deepEqual(values(state, NOW + 2000), [null, null]);
  assert.deepEqual(values({ provider: "claude", status: "unavailable", windows: [] }), [null, null]);
});

test("windowTokens caps TTL at 24h", () => {
  const state = ok("claude", [{ label: "wk", usedPercent: 1, resetsAt: NOW + 900_000 }]);
  assert.equal(windowTokens(state, NOW)[0].ttlMs, 86_400_000);
});

test("claude: statusLine payload round-trips through the cache", () => {
  const cache = path.join(tmp(), "nested", "claude.json");
  const payload = {
    model: { id: "x" },
    rate_limits: {
      five_hour: { used_percentage: 12.5, resets_at: NOW + 3600 },
      seven_day: { used_percentage: 40, resets_at: NOW + 86400 },
    },
  };
  assert.equal(claude.cacheFromStatusLine(payload, cache, NOW), true);
  assert.deepEqual(claude.read(cache), ok("claude", [
    { label: "5h", usedPercent: 12.5, resetsAt: NOW + 3600 },
    { label: "wk", usedPercent: 40, resetsAt: NOW + 86400 },
  ]));
});

test("claude: payload without rate_limits keeps the previous cache", () => {
  const cache = path.join(tmp(), "claude.json");
  claude.cacheFromStatusLine({ rate_limits: { seven_day: { used_percentage: 7, resets_at: NOW + 9 } } }, cache, NOW);
  assert.equal(claude.cacheFromStatusLine({ model: {} }, cache, NOW + 5), false);
  assert.equal(claude.read(cache).windows[0].usedPercent, 7);
});

test("claude: missing or corrupt cache degrades to unavailable", () => {
  const dir = tmp();
  assert.equal(claude.read(path.join(dir, "none.json")).status, "unavailable");
  fs.writeFileSync(path.join(dir, "bad.json"), "{");
  assert.equal(claude.read(path.join(dir, "bad.json")).status, "unavailable");
});

function writeRollout(home, day, name, lines, mtimeSec) {
  const dir = path.join(home, "sessions", "2026", "10", day);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
  fs.utimesSync(file, mtimeSec, mtimeSec);
  return file;
}

const tokenCount = (primary, secondary) => ({
  timestamp: "2026-10-05T10:00:00.000Z",
  type: "event_msg",
  payload: {
    type: "token_count",
    rate_limits: {
      limit_id: "codex",
      primary: { used_percent: primary, window_minutes: 300, resets_at: NOW + 100 },
      secondary: { used_percent: secondary, window_minutes: 10080, resets_at: NOW + 1000 },
    },
  },
});

test("codex: newest rollout's last rate_limits wins", () => {
  const home = tmp();
  writeRollout(home, "04", "rollout-a.jsonl", [tokenCount(90, 90)], NOW - 1000);
  writeRollout(home, "05", "rollout-b.jsonl", [tokenCount(10, 20), "{truncated", tokenCount(34, 55)], NOW);
  const state = codex.read(home);
  assert.equal(state.status, "ok");
  assert.deepEqual(values(state), ["○ 5h 34%", "◐ wk 55%"]);
  assert.equal(state.observedAt, Math.floor(Date.parse("2026-10-05T10:00:00.000Z") / 1000));
});

test("codex: falls back to an older rollout when the newest has no rate_limits", () => {
  const home = tmp();
  writeRollout(home, "05", "rollout-a.jsonl", [tokenCount(1, 2)], NOW - 50);
  writeRollout(home, "05", "rollout-b.jsonl", [{ type: "session_meta", payload: {} }], NOW);
  assert.deepEqual(values(codex.read(home)), ["○ 5h 1%", "○ wk 2%"]);
});

test("codex: ignores rate limit buckets other than the main one", () => {
  const home = tmp();
  const premium = tokenCount(99, 99);
  premium.payload.rate_limits.limit_id = "premium";
  writeRollout(home, "05", "rollout-a.jsonl", [tokenCount(34, 55), premium], NOW);
  assert.deepEqual(values(codex.read(home)), ["○ 5h 34%", "◐ wk 55%"]);
});

test("codex: considers a session from the previous day directory", () => {
  const home = tmp();
  for (let i = 0; i < 6; i++) writeRollout(home, "05", `rollout-new-${i}.jsonl`, [{ type: "x" }], NOW - 100);
  writeRollout(home, "04", "rollout-old.jsonl", [tokenCount(1, 2)], NOW);
  assert.deepEqual(values(codex.read(home)), ["○ 5h 1%", "○ wk 2%"]);
});

test("claude: an idle pane's older reading never replaces a newer one", () => {
  const cache = path.join(tmp(), "claude.json");
  const send = (five) => claude.cacheFromStatusLine({ rate_limits: { five_hour: five } }, cache, NOW);
  send({ used_percentage: 70, resets_at: NOW + 3600 });
  send({ used_percentage: 20, resets_at: NOW + 3605 }); // same window, stale pane
  assert.equal(claude.read(cache).windows[0].usedPercent, 70);
  send({ used_percentage: 5, resets_at: NOW + 3600 - 18000 }); // previous window
  assert.equal(claude.read(cache).windows[0].usedPercent, 70);
  send({ used_percentage: 3, resets_at: NOW + 3600 + 18000 }); // next window
  assert.equal(claude.read(cache).windows[0].usedPercent, 3);
});

test("claude: a payload missing one window keeps the cached one", () => {
  const cache = path.join(tmp(), "claude.json");
  claude.cacheFromStatusLine({ rate_limits: {
    five_hour: { used_percentage: 10, resets_at: NOW + 60 },
    seven_day: { used_percentage: 30, resets_at: NOW + 600 },
  } }, cache, NOW);
  claude.cacheFromStatusLine({ rate_limits: { seven_day: { used_percentage: 31, resets_at: NOW + 600 } } }, cache, NOW);
  assert.deepEqual(claude.read(cache).windows.map((w) => w.usedPercent), [10, 31]);
});

test("codex: missing sessions dir degrades to unavailable", () => {
  assert.equal(codex.read(path.join(tmp(), "nope")).status, "unavailable");
});

test("planReports shows each provider once and clears the other panes", () => {
  const states = {
    claude: ok("claude", [{ label: "5h", usedPercent: 10, resetsAt: NOW + 60 }]),
    codex: ok("codex", [
      { label: "5h", usedPercent: 60, resetsAt: NOW + 60 },
      { label: "wk", usedPercent: 90, resetsAt: NOW + 90 },
    ]),
  };
  const agents = [
    { pane_id: "c1", agent: "claude", tokens: { herdr_usage_2: "○ wk 1%" } },
    { pane_id: "c2", agent: "claude", tokens: { herdr_usage_1: "○ 5h 10%" } },
    { pane_id: "c3", agent: "claude" },
    { pane_id: "x1", agent: "codex", tokens: { herdr_usage_1: "◐ 5h 60%" } },
    { pane_id: "x2", agent: "codex" },
    { pane_id: "p1", agent: "pi" },
    { pane_id: "p2", agent: "pi", tokens: { herdr_usage_1: "○ 5h 9%" } }, // was a claude pane
  ];
  assert.deepEqual(planReports(agents, states, NOW), [
    {
      paneId: "c1",
      set: [
        { name: "herdr_usage_1", value: "○ 5h 10%", ttlMs: 60_000 },
        { name: "herdr_usage_icon", value: ICONS.claude, ttlMs: 60_000 },
      ],
      clear: ["herdr_usage_2"],
    },
    { paneId: "c2", set: [], clear: ["herdr_usage_1"] },
    {
      paneId: "x1",
      set: [
        { name: "herdr_usage_2", value: "● wk 90%", ttlMs: 90_000 },
        { name: "herdr_usage_icon", value: ICONS.codex, ttlMs: 90_000 },
      ],
      clear: [],
    },
    { paneId: "p2", set: [], clear: ["herdr_usage_1"] },
  ]);
});

test("planReports clears tokens of an unavailable provider", () => {
  const states = { claude: { provider: "claude", status: "unavailable", windows: [] } };
  const tokens = { herdr_usage_1: "○ 5h 1%", herdr_usage_2: "○ wk 1%", herdr_usage_icon: ICONS.claude };
  const agents = [{ pane_id: "c1", agent: "claude", tokens }];
  assert.deepEqual(planReports(agents, states, NOW), [
    { paneId: "c1", set: [], clear: ["herdr_usage_1", "herdr_usage_2", "herdr_usage_icon"] },
  ]);
});

test("reportCommands sets each token with its own TTL, then clears", () => {
  const report = { paneId: "w1:p1", set: [{ name: "herdr_usage_1", value: "○ 5h 10%", ttlMs: 5 }], clear: ["herdr_usage_2"] };
  assert.deepEqual(reportCommands(report), [
    ["pane", "report-metadata", "w1:p1", "--source", "herdr-usage", "--token", "herdr_usage_1=○ 5h 10%", "--ttl-ms", "5"],
    ["pane", "report-metadata", "w1:p1", "--source", "herdr-usage", "--clear-token", "herdr_usage_2"],
  ]);
});

test("statusLineShell matches Claude Code: sh on Unix, Git Bash or PowerShell on Windows", () => {
  const { statusLineShell } = require("../src/cli");
  assert.equal(statusLineShell({ SHELL: process.execPath }, "linux"), "/bin/sh");
  assert.equal(statusLineShell({ SHELL: "/usr/bin/fish" }, "darwin"), "/bin/sh");
  const bash = path.join(tmp(), "bash.exe");
  fs.writeFileSync(bash, "");
  assert.equal(statusLineShell({ CLAUDE_CODE_GIT_BASH_PATH: bash }, "win32"), bash);
  assert.equal(statusLineShell({ SHELL: bash }, "win32"), bash);
  assert.equal(statusLineShell({ SHELL: process.execPath }, "win32"), "powershell.exe");
  assert.equal(statusLineShell({}, "win32"), "powershell.exe");
});

function withStateDir(fn) {
  const dir = tmp();
  const prev = process.env.HERDR_PLUGIN_STATE_DIR;
  process.env.HERDR_PLUGIN_STATE_DIR = dir;
  try {
    fn(dir);
  } finally {
    if (prev === undefined) delete process.env.HERDR_PLUGIN_STATE_DIR;
    else process.env.HERDR_PLUGIN_STATE_DIR = prev;
  }
}

test("chainedStatusLine keeps the output of a script that exits non-zero", () => {
  const { chainedStatusLine } = require("../src/cli");
  withStateDir((dir) => {
    fs.writeFileSync(path.join(dir, "claude-statusline-chain.json"), JSON.stringify({ command: "echo line; exit 1" }));
    assert.equal(chainedStatusLine("{}").trim(), "line");
  });
});

test("publishDue publishes on change, otherwise once per interval", () => {
  const { publishDue } = require("../src/cli");
  withStateDir((dir) => {
    assert.equal(publishDue("a", 1000), true);
    fs.writeFileSync(path.join(dir, "last-publish.json"), JSON.stringify({ signature: "a", at: 1000 }));
    assert.equal(publishDue("a", 2000), false);
    assert.equal(publishDue("b", 2000), true);
    assert.equal(publishDue("a", 16_000), true);
  });
});
