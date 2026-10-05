const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { setup, uninstall, logPath, disabledPath } = require("../src/setup");
const { hookPath, hookSource, writeHook, healHook } = require("../src/launcher");
const { managedCheckout } = require("../src/paths");

// Every directory the setup touches is inside one temp root.
function sandbox({ config = "[theme]\nname = \"dracula\"\n" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-usage-setup-"));
  const p = (...parts) => path.join(root, ...parts);
  const env = {
    HOME: p("home"),
    USERPROFILE: p("home"),
    APPDATA: p("appdata"),
    LOCALAPPDATA: p("local"),
    XDG_CONFIG_HOME: p("xdg-config"),
    XDG_DATA_HOME: p("xdg-data"),
    XDG_STATE_HOME: p("xdg-state"),
    CLAUDE_CONFIG_DIR: p("claude"),
    CODEX_HOME: p("codex"),
    HERDR_PLUGIN_STATE_DIR: p("state"),
    HERDR_CONFIG_PATH: p("herdr", "config.toml"),
    HERDR_BIN_PATH: "herdr-stub",
  };
  fs.mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
  fs.mkdirSync(env.CODEX_HOME, { recursive: true });
  fs.mkdirSync(path.dirname(env.HERDR_CONFIG_PATH), { recursive: true });
  if (config !== null) fs.writeFileSync(env.HERDR_CONFIG_PATH, config);
  const calls = [];
  const exec = (bin, args) => calls.push([bin, ...args].join(" "));
  const published = [];
  const opts = { platform: "linux", exec, publish: () => published.push(1) };
  return { env, calls, published, opts, root };
}

test("setup does every step; a second run changes nothing", () => {
  const { env, calls, published, opts } = sandbox();
  const lines = setup(env, opts);
  const out = lines.join("\n");
  assert.match(out, /font: installed/);
  assert.match(out, /launcher: wrote/);
  assert.match(out, /claude: statusLine installed/);
  assert.match(out, /codex: Stop hook installed/);
  assert.match(out, /herdr: sidebar rows set/);
  assert.equal(lines[lines.length - 1], "Fully quit and reopen your terminal app so it loads the font.");
  assert.equal(published.length, 1);
  assert.ok(calls.includes("herdr-stub server reload-config"));

  const hook = hookPath(env).replace(/\\/g, "/");
  assert.equal(JSON.parse(fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR, "settings.json"), "utf8")).statusLine.command, `node "${hook}" claude-statusline`);
  assert.match(fs.readFileSync(path.join(env.CODEX_HOME, "hooks.json"), "utf8"), /hook\.js\\?" codex-hook/);
  const config = fs.readFileSync(env.HERDR_CONFIG_PATH, "utf8");
  assert.match(config, /claude = .*#ff5555/);
  assert.ok(fs.readdirSync(path.join(env.XDG_DATA_HOME, "fonts")).some((n) => n.startsWith("HerdrUsageIcons-")));

  calls.length = 0;
  const again = setup(env, opts).join("\n");
  assert.match(again, /claude: already installed/);
  assert.match(again, /codex: already installed/);
  assert.match(again, /herdr: config.toml already set up/);
  assert.doesNotMatch(again, /Fully quit/);
  assert.equal(fs.readFileSync(env.HERDR_CONFIG_PATH, "utf8"), config);
  assert.ok(!calls.includes("herdr-stub server reload-config"), "no reload without a change");
});

test("setup keeps going when one step fails", () => {
  const { env, opts } = sandbox();
  fs.writeFileSync(path.join(env.CLAUDE_CONFIG_DIR, "settings.json"), "{ not json");
  const out = setup(env, { ...opts, publish: () => { throw new Error("no herdr"); } }).join("\n");
  assert.match(out, /claude: error: cannot parse/);
  assert.match(out, /codex: Stop hook installed/);
  assert.match(out, /herdr: sidebar rows set/);
  const failing = setup(env, { ...opts, exec: () => { throw new Error("boom"); } }).join("\n");
  assert.match(failing, /launcher: wrote/);
  assert.match(failing, /could not run herdr|already set up/);
  assert.ok(fs.existsSync(hookPath(env)));
});

test("setup --build points the launcher at the managed checkout, otherwise at this code", () => {
  const { env } = sandbox();
  writeHook(env, { build: true });
  assert.match(fs.readFileSync(hookPath(env), "utf8"), /herdr-usage-ceef692b895f/);
  assert.ok(fs.readFileSync(hookPath(env), "utf8").includes(JSON.stringify(path.join(managedCheckout(env), "src", "cli.js"))));
  writeHook(env);
  assert.ok(fs.readFileSync(hookPath(env), "utf8").includes(JSON.stringify(path.resolve(__dirname, "..", "src", "cli.js"))));
});

test("uninstall reverses setup", () => {
  const { env, opts } = sandbox({ config: "[ui]\nx = 1" });
  const settingsFile = path.join(env.CLAUDE_CONFIG_DIR, "settings.json");
  fs.writeFileSync(settingsFile, JSON.stringify({ statusLine: { type: "command", command: "my-line" } }));
  setup(env, opts);
  const out = uninstall(env, opts).join("\n");
  assert.match(out, /claude: statusLine restored/);
  assert.match(out, /codex: Stop hook removed/);
  assert.match(out, /herdr: sidebar rows removed/);
  assert.match(out, /font: removed/);
  assert.match(out, /setup: disabled/);
  assert.equal(JSON.parse(fs.readFileSync(settingsFile, "utf8")).statusLine.command, "my-line");
  assert.equal(fs.readFileSync(env.HERDR_CONFIG_PATH, "utf8"), "[ui]\nx = 1");
  assert.equal(fs.existsSync(hookPath(env)), true, "hook.js stays, inert");
  assert.equal(fs.existsSync(disabledPath(env)), true);
  assert.deepEqual(fs.readdirSync(path.join(env.XDG_DATA_HOME, "fonts")), []);
});

// --- hook.js -------------------------------------------------------------

function runHook(file, arg) {
  return spawnSync(process.execPath, [file, arg], { encoding: "utf8" });
}

test("hook.js exits 0 and prints nothing when the plugin is gone", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-usage-hook-"));
  const hook = path.join(dir, "hook.js");
  fs.writeFileSync(hook, hookSource(path.join(dir, "missing", "src", "cli.js")));
  const result = runHook(hook, "claude-statusline");
  assert.equal(result.status, 0);
  assert.equal(result.stdout + result.stderr, "");
});

test("hook.js runs main of its target with the hook name", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-usage-hook-"));
  const target = path.join(dir, "cli.js");
  fs.writeFileSync(target, 'exports.main = (name) => console.log("ran " + name);\n');
  const hook = path.join(dir, "hook.js");
  fs.writeFileSync(hook, hookSource(target));
  const result = runHook(hook, "codex-hook");
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "ran codex-hook");
  // a target that throws never breaks the agent
  fs.writeFileSync(target, 'exports.main = () => { throw new Error("x"); };\n');
  assert.equal(runHook(hook, "codex-hook").status, 0);
});

test("the real launcher forwards to cli.js (end to end)", () => {
  const { env } = sandbox();
  writeHook(env);
  const result = spawnSync(process.execPath, [hookPath(env), "codex-hook"], { encoding: "utf8", env: { ...process.env, ...env }, input: "" });
  assert.equal(result.status, 0);
});

test("cli with no command prints the usage and exits 2", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "..", "src", "cli.js")], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: herdr-usage <status\|publish\|setup\|uninstall\|claude-statusline\|codex-hook>/);
});

// --- log, notification, opt-out, self-heal ---------------------------------

const notifications = (seen) => seen.filter((a) => a[0] === "notification");

test("setup writes its full report to setup.log, overwriting the old one", () => {
  const { env, opts } = sandbox();
  fs.mkdirSync(path.dirname(logPath(env)), { recursive: true });
  fs.writeFileSync(logPath(env), "old run\n");
  const lines = setup(env, opts);
  assert.equal(fs.readFileSync(logPath(env), "utf8"), `${lines.join("\n")}\n`);
});

test("setup --build sends a notification, and setup without --build does not", () => {
  const { env, opts } = sandbox();
  const seen = [];
  setup(env, { ...opts, exec: (bin, args) => seen.push(args) });
  assert.deepEqual(notifications(seen), []);
  setup(env, { ...opts, build: true, exec: (bin, args) => seen.push(args) });
  const [note] = notifications(seen);
  assert.deepEqual(note.slice(0, 4), ["notification", "show", "herdr-usage", "--body"]);
  assert.equal(note[4], "Set up for claude, codex.");
});

test("the notification mentions the restart only for a new font, and asks for attention on a problem", () => {
  const { env, opts } = sandbox();
  const seen = [];
  const exec = (bin, args) => seen.push(args);
  setup(env, { ...opts, build: true, exec });
  assert.equal(notifications(seen)[0][4], "Set up for claude, codex. Fully restart your terminal to see the logos.");
  fs.writeFileSync(path.join(env.CLAUDE_CONFIG_DIR, "settings.json"), "{ not json");
  seen.length = 0;
  setup(env, { ...opts, build: true, exec });
  assert.equal(
    notifications(seen)[0][4],
    "Setup needs attention: run `herdr plugin action invoke herdr-usage.setup` to see what to do.",
  );
  // a failing notification never fails the setup
  assert.doesNotThrow(() => setup(env, { ...opts, build: true, exec: () => { throw new Error("no herdr"); } }));
});

test("after uninstall, setup --build does nothing; setup without --build enables it again", () => {
  const { env, calls, opts } = sandbox();
  setup(env, opts);
  uninstall(env, opts);
  const before = fs.readFileSync(env.HERDR_CONFIG_PATH, "utf8");
  fs.rmSync(path.join(env.CLAUDE_CONFIG_DIR, "settings.json"), { force: true });
  calls.length = 0;
  const lines = setup(env, { ...opts, build: true });
  assert.deepEqual(lines, ["setup skipped: run the herdr-usage.setup action to enable again"]);
  assert.equal(fs.readFileSync(env.HERDR_CONFIG_PATH, "utf8"), before);
  assert.equal(fs.existsSync(path.join(env.CLAUDE_CONFIG_DIR, "settings.json")), false);
  assert.deepEqual(calls, []);
  assert.equal(fs.readFileSync(logPath(env), "utf8"), `${lines[0]}\n`);
  setup(env, opts);
  assert.equal(fs.existsSync(disabledPath(env)), false);
  assert.ok(fs.existsSync(path.join(env.CLAUDE_CONFIG_DIR, "settings.json")));
  assert.match(setup(env, { ...opts, build: true }).join("\n"), /launcher: wrote/);
});

test("setup skips the agent hooks when the launcher cannot be written", () => {
  const { env, opts } = sandbox();
  fs.mkdirSync(path.dirname(path.dirname(hookPath(env))), { recursive: true });
  fs.writeFileSync(path.dirname(hookPath(env)), "a file, not a directory");
  const out = setup(env, opts).join("\n");
  assert.match(out, /launcher: error: /);
  assert.match(out, /hooks: skipped \(launcher not written\)/);
  assert.equal(fs.existsSync(path.join(env.CLAUDE_CONFIG_DIR, "settings.json")), false);
  assert.match(out, /herdr: sidebar rows set/);
});

test("healHook repoints a launcher whose target is gone, and leaves a good one alone", () => {
  const { env, root } = sandbox();
  assert.equal(healHook(env), false, "no launcher yet");
  fs.mkdirSync(path.dirname(hookPath(env)), { recursive: true });
  fs.writeFileSync(hookPath(env), hookSource(path.join(root, "gone", "src", "cli.js")));
  assert.equal(healHook(env), true);
  assert.ok(fs.readFileSync(hookPath(env), "utf8").includes(JSON.stringify(path.resolve(__dirname, "..", "src", "cli.js"))));
  assert.equal(healHook(env), false);
});
