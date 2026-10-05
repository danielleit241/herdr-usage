const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const hc = require("../src/herdr-config");

const PROVIDERS = [
  { id: "claude", logoColor: null },
  { id: "codex", logoColor: null },
];
const COLORS = { green: "#a6e3a1", yellow: "#f9e2af", red: "#f38ba8" };
const add = (text) => hc.addBlock(text, { providers: PROVIDERS, colors: COLORS });

function sandbox(original) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-usage-safety-"));
  const file = path.join(dir, "config.toml");
  fs.writeFileSync(file, original);
  const calls = [];
  const make = ({ bad = () => false } = {}) => (bin, args, extra) => {
    calls.push(args.join(" "));
    if (args[0] === "config" && bad(extra.HERDR_CONFIG_PATH)) throw Object.assign(new Error("exit 1"), { status: 1 });
  };
  return { file, env: { HERDR_CONFIG_PATH: file, HERDR_BIN_PATH: "herdr-stub" }, calls, make };
}
const read = (file) => fs.readFileSync(file, "utf8");

test("removeRows needs no valid config and does not run herdr config check", () => {
  const { file, env, calls, make } = sandbox("[ui]\nx = 1\n");
  hc.setupRows(env, { exec: make(), platform: "linux" });
  calls.length = 0;
  const result = hc.removeRows(env, { exec: make({ bad: () => true }), platform: "linux" });
  assert.equal(result.changed, true);
  assert.equal(read(file), "[ui]\nx = 1\n");
  assert.equal(calls.length, 0);
});

test("the replaced file keeps the mode of the original", { skip: process.platform === "win32" }, () => {
  const { file, env, make } = sandbox("[ui]\n");
  fs.chmodSync(file, 0o600);
  hc.setupRows(env, { exec: make(), platform: "linux" });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("a foreign key between the markers survives strip and re-add", () => {
  const lines = add("[ui]\nx = 1\n").text.split("\n");
  lines.splice(lines.indexOf(hc.START) + 1, 0, "mouse_capture = true"); // where herdr's writer puts it
  const edited = lines.join("\n");
  const kept = "[ui]\nx = 1\nmouse_capture = true\n";
  assert.equal(hc.stripBlock(edited), kept);
  const again = add(edited).text.split("\n");
  assert.equal(again.filter((l) => l === hc.START).length, 1);
  assert.equal(again.filter((l) => l.startsWith("claude = ")).length, 1);
  assert.equal(hc.stripBlock(again.join("\n")), kept);
});

test("a damaged block is reported and nothing is edited, by setup and by uninstall", () => {
  const samples = [
    `[ui]\n${hc.END}\n`,
    `[ui]\n${hc.START}\nclaude = 1\n`,
    `${hc.END}\n${hc.START}\n`,
    `${hc.START}\n${hc.START}\n${hc.END}\n`,
  ];
  for (const original of samples) {
    assert.ok(hc.blockProblem(original), JSON.stringify(original));
    assert.equal(hc.stripBlock(original), original);
    for (const action of ["setupRows", "removeRows"]) {
      const { file, env, make } = sandbox(original);
      const result = hc[action](env, { exec: make(), platform: "linux" });
      assert.equal(result.changed, false);
      assert.equal(result.lines[0], "herdr: managed block in config.toml is damaged; fix it by hand");
      assert.match(result.lines[1], /line|no "/);
      assert.equal(read(file), original);
    }
  }
  assert.equal(hc.blockProblem(add("[ui]\n").text), null);
});

test("dotted rows keys are not guessed: no edit, with a hint", () => {
  const samples = [
    '[ui]\nsidebar.agents.rows = [["agent"]]\n',
    '[ui.sidebar]\nagents.rows = [["agent"]]\n',
    'ui.sidebar.agents.rows = [["agent"]]\n',
    '[ui.sidebar]\n"agents" . rows = [["agent"]]\n',
  ];
  for (const original of samples) {
    const { file, env, make } = sandbox(original);
    const result = hc.setupRows(env, { exec: make(), platform: "linux" });
    assert.equal(result.changed, false, original);
    assert.match(result.lines.join("\n"), /dotted key .*move them under \[ui\.sidebar\.agents\] as `rows = \.\.\.`/, original);
    assert.equal(read(file), original);
  }
  // a quoted key that only contains a dot is not a dotted key
  assert.ok(add('[ui.sidebar.agents]\n"a.b" = 1\nrows = [["agent"]]\n').text.includes("claude = "));
});
