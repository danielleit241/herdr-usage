const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { fontDir, installFont, uninstallFont, WIN_FONT_NAME } = require("../src/font");
const { ICONS } = require("../src/herdr");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "herdr-usage-font-"));
const installed = (dir) => fs.readdirSync(dir).filter((n) => n.startsWith("HerdrUsageIcons"));

test("fontDir uses the per-user font folder of each platform", () => {
  const home = path.join("h");
  assert.equal(fontDir({ HOME: home }, "darwin"), path.join(home, "Library", "Fonts"));
  assert.equal(fontDir({ HOME: home }, "linux"), path.join(home, ".local", "share", "fonts"));
  assert.equal(fontDir({ HOME: home, XDG_DATA_HOME: "x" }, "linux"), path.join("x", "fonts"));
  assert.equal(fontDir({ LOCALAPPDATA: "l" }, "win32"), path.join("l", "Microsoft", "Windows", "Fonts"));
});

test("installFont copies the font under a hashed name and refreshes fontconfig on Linux", () => {
  const env = { HOME: tmp() };
  const dir = fontDir(env, "linux");
  const calls = [];
  installFont(env, "linux", (file, args) => calls.push([file, ...args]));
  const files = installed(dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^HerdrUsageIcons-[0-9a-f]{8}\.ttf$/);
  assert.deepEqual(calls, [["fc-cache", "-f", dir]]);
  uninstallFont(env, "linux", () => {});
  assert.deepEqual(installed(dir), []);
});

test("installFont on Windows replaces older installs and registers the new file", () => {
  const env = { LOCALAPPDATA: tmp() };
  const calls = [];
  const exec = (file, args, extra) => calls.push({ file, args, extra });
  const dir = fontDir(env, "win32");
  fs.mkdirSync(dir, { recursive: true });
  for (const old of ["HerdrUsageIcons.otf", "HerdrUsageIcons.ttf", "HerdrUsageIcons-00000000.ttf"]) {
    fs.writeFileSync(path.join(dir, old), "old");
  }
  fs.writeFileSync(path.join(dir, "Other.ttf"), "keep");
  installFont(env, "win32", exec);
  const files = installed(dir);
  assert.equal(files.length, 1, `left: ${files}`);
  assert.ok(fs.existsSync(path.join(dir, "Other.ttf")));
  const target = path.join(dir, files[0]);
  const add = calls.findIndex((c) => c.file === "reg" && c.args[0] === "add");
  assert.ok(calls[add].args.includes(WIN_FONT_NAME) && calls[add].args.includes(target));
  assert.deepEqual(calls[add + 1].extra, { HERDR_USAGE_FONT_OP: "add", HERDR_USAGE_FONT: target });
  // A second install does not load the font again: uninstall unloads it once.
  calls.length = 0;
  installFont(env, "win32", exec);
  assert.ok(!calls.some((c) => c.extra && c.extra.HERDR_USAGE_FONT_OP === "add"));
  calls.length = 0;
  uninstallFont(env, "win32", exec);
  assert.ok(calls.some((c) => c.file === "reg" && c.args[0] === "delete" && c.args.includes(WIN_FONT_NAME)));
  assert.ok(calls.some((c) => c.extra && c.extra.HERDR_USAGE_FONT_OP === "remove" && c.extra.HERDR_USAGE_FONT === target));
  assert.deepEqual(installed(dir), []);
});

test("the shipped font maps every provider icon codepoint", () => {
  // Minimal OpenType cmap reader: format 12 subtable (the only one with > U+FFFF).
  const buf = fs.readFileSync(path.join(__dirname, "..", "fonts", "HerdrUsageIcons.ttf"));
  const numTables = buf.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (buf.toString("latin1", rec, rec + 4) === "cmap") cmap = buf.readUInt32BE(rec + 8);
  }
  assert.ok(cmap >= 0, "no cmap table");
  const mapped = new Set();
  for (let i = 0; i < buf.readUInt16BE(cmap + 2); i++) {
    const sub = cmap + buf.readUInt32BE(cmap + 4 + i * 8 + 4);
    if (buf.readUInt16BE(sub) !== 12) continue;
    for (let g = 0; g < buf.readUInt32BE(sub + 12); g++) {
      const group = sub + 16 + g * 12;
      for (let cp = buf.readUInt32BE(group); cp <= buf.readUInt32BE(group + 4); cp++) mapped.add(cp);
    }
  }
  for (const [provider, glyph] of Object.entries(ICONS)) {
    assert.ok(mapped.has(glyph.codePointAt(0)), `${provider} glyph missing from the font`);
  }
});
