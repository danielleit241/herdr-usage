const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { install, uninstall, chainPath } = require("../src/install");

function sandbox({ claude, codex } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-usage-install-"));
  const env = {
    CLAUDE_CONFIG_DIR: path.join(root, "claude"),
    CODEX_HOME: path.join(root, "codex"),
    HERDR_PLUGIN_STATE_DIR: path.join(root, "state"),
  };
  const files = {
    claude: path.join(env.CLAUDE_CONFIG_DIR, "settings.json"),
    codex: path.join(env.CODEX_HOME, "hooks.json"),
  };
  for (const [key, value] of Object.entries({ claude, codex })) {
    if (value === undefined) continue;
    fs.mkdirSync(path.dirname(files[key]), { recursive: true });
    fs.writeFileSync(files[key], JSON.stringify(value));
  }
  const read = (key) => JSON.parse(fs.readFileSync(files[key], "utf8"));
  return { env, read };
}

const herdrSessionStart = { SessionStart: [{ hooks: [{ type: "command", command: "herdr-agent-state session" }] }] };

test("install adds statusLine and Stop hook, keeping other config", () => {
  const { env, read } = sandbox({ claude: { theme: "dark" }, codex: { hooks: herdrSessionStart } });
  install(env);
  const settings = read("claude");
  assert.equal(settings.theme, "dark");
  assert.match(settings.statusLine.command, /cli\.js" claude-statusline$/);
  const hooks = read("codex").hooks;
  assert.deepEqual(hooks.SessionStart, herdrSessionStart.SessionStart);
  assert.match(hooks.Stop[0].hooks[0].command, /cli\.js" codex-hook$/);
});

test("install is idempotent", () => {
  const { env, read } = sandbox({ codex: { hooks: {} } });
  install(env);
  const before = [read("claude"), read("codex")];
  assert.match(install(env).join("\n"), /already installed[\s\S]*already installed/);
  assert.deepEqual([read("claude"), read("codex")], before);
});

test("install chains an existing statusLine and uninstall restores it", () => {
  const { env, read } = sandbox({ claude: { statusLine: { type: "command", command: "my-line", padding: 1 } } });
  install(env);
  assert.deepEqual(JSON.parse(fs.readFileSync(chainPath(env), "utf8")), { command: "my-line" });
  assert.equal(read("claude").statusLine.padding, 1);
  uninstall(env);
  assert.deepEqual(read("claude").statusLine, { type: "command", command: "my-line", padding: 1 });
  assert.equal(fs.existsSync(chainPath(env)), false);
});

test("uninstall removes only our hooks", () => {
  const { env, read } = sandbox({ claude: {}, codex: { hooks: herdrSessionStart } });
  install(env);
  uninstall(env);
  assert.equal(read("claude").statusLine, undefined);
  assert.deepEqual(read("codex").hooks, herdrSessionStart);
});

test("install refuses to overwrite an unparsable file", () => {
  const { env } = sandbox();
  fs.mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(env.CLAUDE_CONFIG_DIR, "settings.json"), "{ not json");
  assert.throws(() => install(env), /cannot parse/);
});

test("install repoints hooks left by another plugin directory", () => {
  const stale = 'node "/old/place/src/cli.js"';
  const { env, read } = sandbox({
    claude: { statusLine: { type: "command", command: `${stale} claude-statusline` } },
    codex: { hooks: { Stop: [{ hooks: [{ type: "command", command: `${stale} codex-hook` }] }] } },
  });
  install(env);
  assert.doesNotMatch(read("claude").statusLine.command, /old\/place/);
  assert.equal(fs.existsSync(chainPath(env)), false);
  const stop = read("codex").hooks.Stop;
  assert.equal(stop.length, 1);
  assert.doesNotMatch(stop[0].hooks[0].command, /old\/place/);
});

test("install accepts a UTF-8 BOM", () => {
  const { env, read } = sandbox();
  fs.mkdirSync(env.CLAUDE_CONFIG_DIR, { recursive: true });
  fs.writeFileSync(path.join(env.CLAUDE_CONFIG_DIR, "settings.json"), '\uFEFF{"theme":"dark"}');
  install(env);
  assert.equal(read("claude").theme, "dark");
});

test("the backup keeps the original file across install and uninstall", () => {
  const { env } = sandbox({ claude: { orig: 1 } });
  install(env);
  uninstall(env);
  const bak = path.join(env.CLAUDE_CONFIG_DIR, "settings.json.herdr-usage.bak");
  assert.deepEqual(JSON.parse(fs.readFileSync(bak, "utf8")), { orig: 1 });
});

test("a removed statusLine is not brought back by a stale chain file", () => {
  const { env, read } = sandbox({ claude: { statusLine: { type: "command", command: "my-line" } } });
  install(env);
  const settings = read("claude");
  delete settings.statusLine;
  fs.writeFileSync(path.join(env.CLAUDE_CONFIG_DIR, "settings.json"), JSON.stringify(settings));
  install(env);
  uninstall(env);
  assert.equal(read("claude").statusLine, undefined);
});

test("install keeps the chained statusLine when it repoints an old install", () => {
  const { env, read } = sandbox({ claude: { statusLine: { type: "command", command: "my-line" } } });
  install(env);
  const settings = read("claude");
  settings.statusLine.command = 'node "/old/src/cli.js" claude-statusline';
  fs.writeFileSync(path.join(env.CLAUDE_CONFIG_DIR, "settings.json"), JSON.stringify(settings));
  install(env);
  uninstall(env);
  assert.equal(read("claude").statusLine.command, "my-line");
});

test("install drops a stale duplicate Codex hook", () => {
  const { env, read } = sandbox({ codex: { hooks: {} } });
  install(env);
  const config = read("codex");
  config.hooks.Stop.unshift({ hooks: [{ type: "command", command: 'node "/old/src/cli.js" codex-hook' }] });
  fs.writeFileSync(path.join(env.CODEX_HOME, "hooks.json"), JSON.stringify(config));
  install(env);
  assert.equal(read("codex").hooks.Stop.length, 1);
});

test("a non-array hooks.Stop is reported, not crashed on", () => {
  const { env } = sandbox({ codex: { hooks: { Stop: {} } } });
  assert.throws(() => install(env), /hooks\.Stop is not an array/);
});

test("install notes when Codex hooks are not enabled", () => {
  const { env } = sandbox();
  assert.match(install(env).join("\n"), /\[features\] hooks = true/);
  fs.writeFileSync(path.join(env.CODEX_HOME, "config.toml"), "[features]\nmemories = false\nhooks = true\n");
  assert.doesNotMatch(install(env).join("\n"), /features/);
});
