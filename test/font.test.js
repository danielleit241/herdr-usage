const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { fontDir, installFont, uninstallFont, WIN_FONT_NAME } = require("../src/font");
const { ICONS } = require("../src/herdr");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "herdr-usage-font-"));

test("fontDir uses the per-user font folder of each platform", () => {
  const home = path.join("h");
  assert.equal(fontDir({ HOME: home }, "darwin"), path.join(home, "Library", "Fonts"));
  assert.equal(fontDir({ HOME: home }, "linux"), path.join(home, ".local", "share", "fonts"));
  assert.equal(fontDir({ HOME: home, XDG_DATA_HOME: "x" }, "linux"), path.join("x", "fonts"));
  assert.equal(fontDir({ LOCALAPPDATA: "l" }, "win32"), path.join("l", "Microsoft", "Windows", "Fonts"));
});

test("installFont copies the font and refreshes fontconfig on Linux", () => {
  const env = { HOME: tmp() };
  const calls = [];
  installFont(env, "linux", (file, args) => calls.push([file, ...args]));
  const target = path.join(fontDir(env, "linux"), "HerdrUsageIcons.ttf");
  assert.ok(fs.statSync(target).size > 0);
  assert.deepEqual(calls, [["fc-cache", "-f", path.dirname(target)]]);
  uninstallFont(env, "linux", () => {});
  assert.equal(fs.existsSync(target), false);
});

test("installFont registers the font for the user on Windows", () => {
  const env = { LOCALAPPDATA: tmp() };
  const calls = [];
  const exec = (file, args, extra) => calls.push({ file, args, extra });
  const dir = fontDir(env, "win32");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "HerdrUsageIcons.otf"), "old");
  installFont(env, "win32", exec);
  const target = path.join(dir, "HerdrUsageIcons.ttf");
  assert.ok(fs.existsSync(target));
  assert.equal(fs.existsSync(path.join(dir, "HerdrUsageIcons.otf")), false, "0.2.0 font removed");
  const add = calls.findIndex((c) => c.file === "reg" && c.args[0] === "add");
  assert.ok(calls[add].args.includes(WIN_FONT_NAME) && calls[add].args.includes(target));
  assert.deepEqual(calls[add + 1].extra, { HERDR_USAGE_FONT_OP: "add", HERDR_USAGE_FONT: target });
  calls.length = 0;
  uninstallFont(env, "win32", exec);
  assert.deepEqual(calls[0].extra, { HERDR_USAGE_FONT_OP: "remove", HERDR_USAGE_FONT: target });
  assert.deepEqual(calls[1].args.slice(0, 3), ["delete", "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts", "/v"]);
  assert.equal(fs.existsSync(target), false);
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
