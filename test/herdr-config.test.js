const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const hc = require("../src/herdr-config");
const paths = require("../src/paths");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "herdr-usage-config-"));
const PROVIDERS = [
  { id: "claude", logoColor: "#D97757" },
  { id: "codex", logoColor: "#7A9DFF" },
];
const CATPPUCCIN = { green: "#a6e3a1", yellow: "#f9e2af", red: "#f38ba8" };
const add = (text, extra = {}) => hc.addBlock(text, { providers: PROVIDERS, colors: CATPPUCCIN, ...extra });
const keyLine = (text, id) => text.split(/\r?\n/).find((l) => l.startsWith(`${id} = `));

// --- themeColors ---------------------------------------------------------

test("themeColors: catppuccin by default, built-in palette by name or alias", () => {
  assert.deepEqual(hc.themeColors(""), CATPPUCCIN);
  assert.deepEqual(hc.themeColors('[theme]\nname = "dracula"\n'), { green: "#50fa7b", yellow: "#f1fa8c", red: "#ff5555" });
  assert.deepEqual(hc.themeColors('[theme]\nname = "Tokyo Night"\n'), hc.themeColors('[theme]\nname = "tokyonight"\n'));
  assert.equal(hc.themeColors('[theme]\nname = "latte"\n').green, "#40a02b");
});

test("themeColors: [theme.custom] overrides, in hex, short hex and rgb()", () => {
  const text = [
    '[theme]\nname = "dracula"\n',
    "[theme.custom]",
    'green = "#ABC"',
    'yellow = "rgb(255, 128, 0)"',
    'red = "#FF0000"',
    'accent = "#123456"',
  ].join("\n");
  assert.deepEqual(hc.themeColors(text), { green: "#aabbcc", yellow: "#ff8000", red: "#ff0000" });
});

test("themeColors: an ANSI custom color is null, the others stay", () => {
  const colors = hc.themeColors('[theme.custom]\nred = "light_red"\n');
  assert.deepEqual(colors, { green: CATPPUCCIN.green, yellow: CATPPUCCIN.yellow, red: null });
});

test("themeColors: terminal and unknown themes have no hex palette", () => {
  assert.equal(hc.themeColors('[theme]\nname = "terminal"\n'), null);
  assert.equal(hc.themeColors('[theme]\nname = "no-such-theme"\n'), null);
});

test("themeColors: auto_switch without name uses dark_name", () => {
  const text = '[theme]\nauto_switch = true\ndark_name = "nord"\nlight_name = "latte"\n';
  assert.equal(hc.themeColors(text).green, "#a3be8c");
  assert.equal(hc.themeColors(`${text}name = "dracula"\n`).green, "#50fa7b");
});

// --- the block -----------------------------------------------------------

test("addBlock appends the block with its own header when the table is missing", () => {
  const original = '[ui]\nmouse_capture = false\n';
  const { text, notes } = add(original);
  assert.deepEqual(notes, []);
  const lines = text.split("\n");
  assert.equal(lines[2], hc.START);
  assert.equal(lines[3], "[ui.sidebar.agents.rows_by_agent]");
  assert.equal(lines[lines.length - 2], hc.END);
  assert.ok(text.startsWith(original));
  assert.equal(
    keyLine(text, "claude"),
    'claude = [["state_icon", "machine", "workspace", "tab"], [{ token = "$herdr_usage_icon", fg = "#D97757" }, "agent"], ' +
      '[{ token = "$herdr_usage_1", rules = [{ starts_with = "●", fg = "#f38ba8" }, { starts_with = "◐", fg = "#f9e2af" }, { starts_with = "○", fg = "#a6e3a1" }] }, ' +
      '{ token = "$herdr_usage_2", rules = [{ starts_with = "●", fg = "#f38ba8" }, { starts_with = "◐", fg = "#f9e2af" }, { starts_with = "○", fg = "#a6e3a1" }] }]]',
  );
  assert.match(keyLine(text, "codex"), /fg = "#7A9DFF"/);
});

test("addBlock inserts the keys right after an existing header", () => {
  const original = '[ui.sidebar.agents.rows_by_agent]\ngemini = [["agent"]]\n\n[theme]\nname = "nord"\n';
  const { text } = add(original);
  const lines = text.split("\n");
  assert.equal(lines[0], "[ui.sidebar.agents.rows_by_agent]");
  assert.equal(lines[1], hc.START);
  assert.ok(lines[2].startsWith("claude = "));
  assert.ok(lines[3].startsWith("codex = "));
  assert.equal(lines[4], hc.END);
  assert.equal(lines[5], 'gemini = [["agent"]]');
  assert.equal(text.split("[ui.sidebar.agents.rows_by_agent]").length, 2);
});

test("addBlock inherits the user's rows, also over several lines", () => {
  const original = [
    "[ui.sidebar.agents]",
    "rows = [",
    '  ["state_icon", "workspace"], # first row',
    '  ["tab", "agent"],',
    "]",
    "",
  ].join("\n");
  const { text } = add(original);
  assert.match(
    keyLine(text, "claude"),
    /^claude = \[\["state_icon", "workspace"\], \["tab", \{ token = "\$herdr_usage_icon", fg = "#D97757" \}, "agent"\], \[\{ token = "\$herdr_usage_1"/,
  );
  assert.ok(!keyLine(text, "claude").includes("first row"));
});

test("addBlock: the icon is left out when disabled, or when there is no agent element", () => {
  const off = add("", { providers: PROVIDERS.map((p) => ({ id: p.id, logoColor: null })) }).text;
  assert.ok(!off.includes("herdr_usage_icon"));
  assert.match(keyLine(off, "claude"), /\["agent"\], \[\{ token = "\$herdr_usage_1"/);
  const custom = add('[ui.sidebar.agents]\nrows = [["state_icon"], [{ token = "agent", bold = true }]]\n').text;
  assert.ok(!custom.includes("herdr_usage_icon"));
  assert.ok(custom.includes('{ token = "agent", bold = true }], [{ token = "$herdr_usage_1"'));
});

test("addBlock: no theme colors gives plain usage tokens without rules", () => {
  const { text } = add("", { colors: null });
  assert.match(keyLine(text, "claude"), /\["\$herdr_usage_1", "\$herdr_usage_2"\]\]$/);
  assert.ok(!text.includes("starts_with"));
  // one color missing: also plain, a rule needs all three
  assert.ok(!add("", { colors: { ...CATPPUCCIN, red: null } }).text.includes("starts_with"));
});

test("addBlock skips a provider key the user defined", () => {
  const original = '[ui.sidebar.agents.rows_by_agent]\nclaude = [["agent"]]\n"codex" = [["agent"], ["$herdr_usage_1"]]\n';
  const result = add(original);
  assert.deepEqual(result.notes, ["herdr: claude rows kept (yours)", "herdr: codex rows already show usage"]);
  assert.equal(result.text, original);
  assert.equal(result.hand, null);
  // only the free provider gets a key
  const some = add('[ui.sidebar.agents.rows_by_agent]\nclaude = [["agent"]]\n');
  assert.deepEqual(some.notes, ["herdr: claude rows kept (yours)"]);
  assert.ok(keyLine(some.text, "codex"));
  assert.equal(some.text.split("\n").filter((l) => l.startsWith("claude = ")).length, 1);
});

test("addBlock is idempotent and regenerates from the stripped text", () => {
  const original = '[theme]\nname = "dracula"\n';
  const once = add(original).text;
  assert.equal(add(once).text, once);
  const recolored = add(once, { colors: { green: "#111111", yellow: "#222222", red: "#333333" } }).text;
  assert.ok(recolored.includes("#333333") && !recolored.includes("#f38ba8"));
  assert.equal(hc.stripBlock(recolored), original);
});

test("stripBlock restores the original byte for byte (LF, CRLF, no trailing newline, header last)", () => {
  const samples = [
    "",
    "[ui]\nx = 1\n",
    "[ui]\nx = 1",
    "[ui]\r\nx = 1\r\n",
    "[ui]\r\nx = 1",
    "[ui.sidebar.agents.rows_by_agent]",
    "[ui.sidebar.agents.rows_by_agent]\n",
    "[ui.sidebar.agents.rows_by_agent]\r\nother = 1",
    "# only a comment",
  ];
  for (const original of samples) {
    const { text } = add(original);
    assert.notEqual(text, original, JSON.stringify(original));
    assert.equal(hc.stripBlock(text), original, JSON.stringify(original));
  }
});

test("addBlock keeps CRLF line endings", () => {
  const { text } = add("[ui]\r\nx = 1\r\n");
  assert.ok(!/[^\r]\n/.test(text), "a bare LF was added");
});

test("stripBlock leaves a text without a complete block alone", () => {
  assert.equal(hc.stripBlock("a = 1\n"), "a = 1\n");
  assert.equal(hc.stripBlock(`${hc.START}\nclaude = 1\n`), `${hc.START}\nclaude = 1\n`);
});

// --- editing the file ----------------------------------------------------

function sandbox(original) {
  const dir = tmp();
  const file = path.join(dir, "config.toml");
  if (original !== null) fs.writeFileSync(file, original);
  const env = { HERDR_CONFIG_PATH: file, HERDR_BIN_PATH: "herdr-stub" };
  const calls = [];
  // `bad(file)` decides which checked files fail with exit code 1.
  const make = ({ bad = () => false, missing = false } = {}) => (bin, args, extra) => {
    calls.push({ bin, args, file: extra && extra.HERDR_CONFIG_PATH });
    if (missing) throw Object.assign(new Error("spawn herdr-stub ENOENT"), { code: "ENOENT", status: null });
    if (args[0] === "config" && bad(extra.HERDR_CONFIG_PATH)) throw Object.assign(new Error("exit 1"), { status: 1 });
  };
  return { dir, file, env, calls, make };
}
const read = (file) => fs.readFileSync(file, "utf8");

test("setupRows validates the original and the candidate, then replaces the file and keeps a backup", () => {
  const original = '[theme]\nname = "nord"\n';
  const { file, env, calls, make } = sandbox(original);
  const result = hc.setupRows(env, { exec: make(), platform: "linux" });
  assert.equal(result.changed, true);
  assert.match(result.lines.join("\n"), /sidebar rows set/);
  assert.deepEqual(calls.map((c) => c.file), [file, `${file}.${process.pid}.herdr-usage.tmp`]);
  assert.ok(calls.every((c) => c.bin === "herdr-stub" && c.args.join(" ") === "config check"));
  assert.equal(hc.stripBlock(read(file)), original);
  assert.ok(read(file).includes("#a3be8c"), "nord green");
  assert.equal(read(`${file}.herdr-usage.bak`), original);
  assert.equal(fs.existsSync(`${file}.${process.pid}.herdr-usage.tmp`), false);
});

test("setupRows twice leaves the file byte-identical and says so", () => {
  const { file, env, make } = sandbox("[ui]\nx = 1");
  hc.setupRows(env, { exec: make(), platform: "linux" });
  const first = read(file);
  const second = hc.setupRows(env, { exec: make(), platform: "linux" });
  assert.equal(read(file), first);
  assert.equal(second.changed, false);
  assert.deepEqual(second.lines, ["herdr: config.toml already set up"]);
});

test("setupRows creates config.toml when it does not exist (nothing to validate first)", () => {
  const { file, env, calls, make } = sandbox(null);
  const result = hc.setupRows(env, { exec: make(), platform: "linux" });
  assert.equal(result.changed, true);
  assert.match(result.lines[0], /not found, creating it/);
  assert.deepEqual(calls.map((c) => c.file), [`${file}.${process.pid}.herdr-usage.tmp`]);
  assert.equal(fs.existsSync(`${file}.herdr-usage.bak`), false);
  assert.ok(read(file).startsWith(hc.START));
});

test("setupRows leaves the file unchanged when herdr rejects the candidate, and prints the rows", () => {
  const original = "[ui]\nx = 1\n";
  const { file, env, make } = sandbox(original);
  const result = hc.setupRows(env, { exec: make({ bad: (f) => f.endsWith(".tmp") }), platform: "linux" });
  assert.equal(result.changed, false);
  assert.equal(read(file), original);
  assert.equal(fs.existsSync(`${file}.${process.pid}.herdr-usage.tmp`), false);
  const out = result.lines.join("\n");
  assert.match(out, /failed herdr config check, config.toml not edited/);
  assert.match(out, /by hand: add at the end in /);
  assert.match(out, /\[ui\.sidebar\.agents\.rows_by_agent\]\n {2}claude = /);
});

test("setupRows does not edit a config that already has problems", () => {
  const original = "[ui]\nbroken = \n";
  const { file, env, calls, make } = sandbox(original);
  const result = hc.setupRows(env, { exec: make({ bad: (f) => f === file }), platform: "linux" });
  assert.equal(result.lines[0], "herdr: config.toml has problems, not edited; run herdr config check");
  assert.match(result.lines[1], /^herdr: by hand: add at the end in /);
  assert.equal(read(file), original);
  assert.equal(calls.length, 1);
});

test("setupRows leaves the file unchanged when herdr cannot run", () => {
  const original = "[ui]\nx = 1\n";
  const { file, env, make } = sandbox(original);
  const result = hc.setupRows(env, { exec: make({ missing: true }), platform: "linux" });
  assert.equal(result.changed, false);
  assert.equal(read(file), original);
  assert.match(result.lines.join("\n"), /could not run herdr to validate, config.toml not edited/);
  assert.match(result.lines.join("\n"), /by hand: add at the end/);
});

test("removeRows restores the original and reports a file without rows", () => {
  const original = '[theme]\nname = "nord"';
  const { file, env, make } = sandbox(original);
  hc.setupRows(env, { exec: make(), platform: "linux" });
  const removed = hc.removeRows(env, { exec: make(), platform: "linux" });
  assert.equal(removed.changed, true);
  assert.equal(read(file), original);
  assert.deepEqual(hc.removeRows(env, { exec: make(), platform: "linux" }).lines, ["herdr: no managed rows in config.toml"]);
});

test("reloadConfig runs `server reload-config` and ignores a failure", () => {
  const calls = [];
  hc.reloadConfig({ HERDR_BIN_PATH: "h" }, (bin, args) => calls.push([bin, ...args]));
  assert.deepEqual(calls, [["h", "server", "reload-config"]]);
  hc.reloadConfig({}, () => {
    throw new Error("no server");
  });
});

// --- icon on Windows -----------------------------------------------------

test("iconEnabled: always on macOS/Linux; on Windows only with the font in a Windows Terminal font face", () => {
  assert.equal(hc.iconEnabled({}, "linux"), true);
  assert.equal(hc.iconEnabled({}, "darwin"), true);
  const local = tmp();
  const env = { LOCALAPPDATA: local };
  assert.equal(hc.iconEnabled(env, "win32"), false);
  const dir = path.join(local, "Packages", "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe", "LocalState");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "settings.json"), '{ "profiles": { "defaults": { "font": { "face": "Cascadia Mono" } } } }');
  assert.equal(hc.iconEnabled(env, "win32"), false);
  fs.writeFileSync(path.join(dir, "settings.json"), '{ "profiles": { "defaults": { "font": { "face": "Cascadia Mono, HerdrUsageIcons" } } } }');
  assert.equal(hc.iconEnabled(env, "win32"), true);
  const plain = path.join(local, "Microsoft", "Windows Terminal");
  fs.rmSync(dir, { recursive: true });
  fs.mkdirSync(plain, { recursive: true });
  fs.writeFileSync(path.join(plain, "settings.json"), "HerdrUsageIcons");
  assert.equal(hc.iconEnabled(env, "win32"), true);
});

test("setupRows on Windows without the font in Windows Terminal omits the icon and hints", () => {
  const { file, env, make } = sandbox("");
  const result = hc.setupRows({ ...env, LOCALAPPDATA: tmp() }, { exec: make(), platform: "win32" });
  assert.match(result.lines[0], /add HerdrUsageIcons after your main font/);
  assert.ok(!read(file).includes("herdr_usage_icon"));
});

// --- herdr's paths -------------------------------------------------------

test("paths mirror herdr's config locations", () => {
  assert.equal(paths.herdrConfigDir({ XDG_CONFIG_HOME: "x", APPDATA: "a" }, "win32"), path.join("x", "herdr"));
  assert.equal(paths.herdrConfigDir({ APPDATA: "a" }, "win32"), path.join("a", "herdr"));
  assert.equal(paths.herdrConfigDir({ USERPROFILE: "u" }, "win32"), path.join("u", "AppData", "Roaming", "herdr"));
  assert.equal(paths.herdrConfigDir({ HOME: "h" }, "linux"), path.join("h", ".config", "herdr"));
  assert.equal(paths.herdrConfigFile({ HERDR_CONFIG_PATH: "c.toml" }, "linux"), "c.toml");
  assert.equal(paths.herdrConfigFile({ XDG_CONFIG_HOME: "x" }, "linux"), path.join("x", "herdr", "config.toml"));
  const env = { XDG_CONFIG_HOME: "x" };
  assert.equal(paths.managedCheckout(env), path.join("x", "herdr", "plugins", "github", "herdr-usage-ceef692b895f"));
  assert.equal(paths.pluginConfigDir(env), path.join("x", "herdr", "plugins", "config", "herdr-usage"));
});
