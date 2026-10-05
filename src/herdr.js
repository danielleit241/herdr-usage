// Publishes normalized usage to herdr as pane tokens. Each provider shows its
// usage once: on the first of its agent panes in herdr's agent list. The other
// panes of that provider have the tokens cleared, so sessions do not repeat it.

const { execFileSync } = require("node:child_process");
const { windowTokens } = require("./usage");
const { PLUGIN_ID } = require("./paths");

// One token per window slot (Claude five_hour/seven_day, Codex primary/secondary).
// Pane tokens share one map per pane, so the names carry the plugin prefix.
const TOKENS = ["herdr_usage_1", "herdr_usage_2"];

function herdrBin(env = process.env) {
  return env.HERDR_BIN_PATH || "herdr";
}

function run(args, env) {
  return execFileSync(herdrBin(env), args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function listAgents(env) {
  const out = JSON.parse(run(["agent", "list"], env));
  return (out.result && out.result.agents) || [];
}

// Pure planning step. Returns reports of the form
// { paneId, set: [{ name, value, ttlMs }], clear: [name] } for panes that change.
function planReports(agents, statesByProvider, nowSec) {
  const owners = new Set();
  const reports = [];
  for (const agent of agents) {
    // Panes that are not (or no longer) a provider's owner carry no tokens.
    const state = statesByProvider[agent.agent];
    const isOwner = Boolean(state) && !owners.has(agent.agent);
    if (state) owners.add(agent.agent);
    const wanted = isOwner ? windowTokens(state, nowSec, TOKENS.length) : TOKENS.map(() => null);
    const current = agent.tokens || {};
    const report = { paneId: agent.pane_id, set: [], clear: [] };
    TOKENS.forEach((name, i) => {
      const want = wanted[i];
      if (want === null) {
        if (current[name] !== undefined) report.clear.push(name);
      } else if (current[name] !== want.value) {
        report.set.push({ name, ...want });
      }
    });
    if (report.set.length || report.clear.length) reports.push(report);
  }
  return reports;
}

// herdr applies one TTL per call, so each set token gets its own call. No
// `--seq`: every publish recomputes the full state, and a clock step back
// would make herdr ignore sequenced reports.
function reportCommands(report) {
  const base = ["pane", "report-metadata", report.paneId, "--source", PLUGIN_ID];
  const commands = report.set.map((t) => [...base, "--token", `${t.name}=${t.value}`, "--ttl-ms", String(t.ttlMs)]);
  if (report.clear.length) commands.push([...base, ...report.clear.flatMap((n) => ["--clear-token", n])]);
  return commands;
}

// Returns { updated: panes fully updated, failed: error messages }.
// Throws only if herdr is unreachable.
function publish(states, env = process.env, now = Date.now()) {
  const statesByProvider = Object.fromEntries(states.map((s) => [s.provider, s]));
  const reports = planReports(listAgents(env), statesByProvider, Math.floor(now / 1000));
  let updated = 0;
  const failed = [];
  for (const report of reports) {
    let ok = true;
    for (const args of reportCommands(report)) {
      try {
        run(args, env);
      } catch (err) {
        // Usually the pane closed between list and report.
        ok = false;
        failed.push(`${report.paneId}: ${String(err.stderr || err.message).trim()}`);
      }
    }
    if (ok) updated++;
  }
  return { updated, failed };
}

module.exports = { TOKENS, planReports, reportCommands, publish };
