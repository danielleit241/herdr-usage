// Edits herdr's config.toml as text (no TOML library), so the sidebar shows the
// usage rows without the user editing it. herdr plugins cannot contribute
// config, so this is the only way.
//
// What it writes: one managed block between two marker lines, inside the
// `[ui.sidebar.agents.rows_by_agent]` table, one key per provider:
//
//   <id> = <the user's rows, or herdr's default>
//          + the logo token in front of "agent" (when the font can show it)
//          + one row with the two usage tokens, colored like the theme's
//            green / yellow / red
//
// Safety: the original and the candidate go through `herdr config check`; the file
// is replaced only when the candidate is valid. Removing the markers and the lines
// between them restores the original byte for byte.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const paths = require("./paths");
const icons = require("../assets/icons.json");
const { PROVIDERS } = require("./providers");
const { herdrBin } = require("./herdr");
const { run } = require("./exec");

const SECTION = "ui.sidebar.agents.rows_by_agent";
const START = "# >>> herdr-usage (managed: run the herdr-usage.uninstall action to remove)";
const END = "# <<< herdr-usage";
const START_RE = /^# >>> herdr-usage(\s|$)/;
const END_RE = /^# <<< herdr-usage\s*$/;
// What herdr renders without `[ui.sidebar.agents] rows` (config/sidebar.rs).
const DEFAULT_ROWS = '[["state_icon", "machine", "workspace", "tab"], ["agent"]]';
const WINDOWS_TERMINAL_DIRS = [
  ["Packages", "Microsoft.WindowsTerminal_8wekyb3d8bbwe", "LocalState"],
  ["Packages", "Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe", "LocalState"],
  ["Microsoft", "Windows Terminal"],
];
const WINDOWS_TERMINAL_HINT =
  "herdr: logo off: add HerdrUsageIcons after your main font in the Windows Terminal font face " +
  '(for example "Cascadia Mono, HerdrUsageIcons"), then run the herdr-usage.setup action again';

// --- theme colors --------------------------------------------------------

// green, yellow, red of the built-in themes. Source: herdr 0.9.3, src/app/state.rs
// (the `Theme` constructors, `from_name`). "terminal" uses ANSI colors, so it has
// no entry. Update this table when herdr adds or changes a theme.
const PALETTES = {
  catppuccin: [[166, 227, 161], [249, 226, 175], [243, 139, 168]],
  "catppuccin-latte": [[64, 160, 43], [223, 142, 29], [210, 15, 57]],
  "tokyo-night": [[158, 206, 106], [224, 175, 104], [247, 118, 142]],
  "tokyo-night-day": [[88, 117, 57], [140, 108, 62], [245, 42, 101]],
  dracula: [[80, 250, 123], [241, 250, 140], [255, 85, 85]],
  nord: [[163, 190, 140], [235, 203, 139], [191, 97, 106]],
  gruvbox: [[184, 187, 38], [250, 189, 47], [251, 73, 52]],
  "gruvbox-light": [[121, 116, 14], [181, 118, 20], [157, 0, 6]],
  "one-dark": [[152, 195, 121], [229, 192, 123], [224, 108, 117]],
  "one-light": [[80, 161, 79], [193, 132, 1], [228, 86, 73]],
  solarized: [[133, 153, 0], [181, 137, 0], [220, 50, 47]],
  "solarized-light": [[133, 153, 0], [181, 137, 0], [220, 50, 47]],
  kanagawa: [[118, 148, 106], [192, 163, 110], [195, 64, 67]],
  "kanagawa-lotus": [[111, 137, 78], [119, 113, 63], [200, 64, 83]],
  "rose-pine": [[49, 116, 143], [246, 193, 119], [235, 111, 146]],
  "rose-pine-dawn": [[40, 105, 131], [234, 157, 52], [180, 99, 122]],
  vesper: [[153, 255, 228], [255, 199, 153], [255, 128, 128]],
};

// Theme name aliases of herdr 0.9.3, src/config/theme.rs `canonical_theme_name`.
const THEME_ALIASES = {
  "catppuccin-mocha": "catppuccin",
  latte: "catppuccin-latte",
  light: "catppuccin-latte",
  tokyonight: "tokyo-night",
  "tokyo-day": "tokyo-night-day",
  "tokyonight-day": "tokyo-night-day",
  "gruvbox-dark": "gruvbox",
  onedark: "one-dark",
  onelight: "one-light",
  "solarized-dark": "solarized",
  lotus: "kanagawa-lotus",
  rosepine: "rose-pine",
  "rosepine-dawn": "rose-pine-dawn",
  dawn: "rose-pine-dawn",
};

const hex = ([r, g, b]) => `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;

// A `[theme.custom]` value as #rrggbb, or null for ANSI names and anything else.
function parseColor(value) {
  const text = unquote(value);
  const long = /^#([0-9a-f]{6})$/i.exec(text);
  if (long) return `#${long[1].toLowerCase()}`;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  if (short) return `#${short.slice(1).map((c) => c + c).join("").toLowerCase()}`;
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(text);
  if (rgb && rgb.slice(1).every((n) => +n <= 255)) return hex(rgb.slice(1).map(Number));
  return null;
}

function unquote(value) {
  const m = /^"((?:[^"\\]|\\.)*)"$|^'([^']*)'$/.exec(String(value).trim());
  return m ? (m[1] ?? m[2]) : String(value).trim();
}

// { green, yellow, red } as #rrggbb (null for one color that is not a hex or rgb()
// value), or null when the palette is unknown: the "terminal" theme and unknown names.
function themeColors(text) {
  const items = scan(splitLines(text));
  const get = (section, key) => items.find((i) => i.section === section && i.key === key)?.value;
  let name = get("theme", "name");
  if (name === undefined && get("theme", "auto_switch") === "true") name = get("theme", "dark_name");
  const slug = unquote(name ?? "catppuccin").toLowerCase().replace(/[ _]/g, "-");
  const palette = PALETTES[THEME_ALIASES[slug] || slug];
  if (!palette) return null;
  const colors = {};
  ["green", "yellow", "red"].forEach((color, i) => {
    const custom = get("theme.custom", color);
    colors[color] = custom === undefined ? hex(palette[i]) : parseColor(custom);
  });
  return colors;
}

// --- reading config.toml -------------------------------------------------

// Lines keep their terminator, so joining them gives back the exact text.
const splitLines = (text) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
const bare = (line) => line.replace(/\r?\n$/, "");

// Reads a value that starts at `col` of lines[start]. Strings are skipped, comments
// dropped, and an array or inline table may span lines (joined into one line).
// Returns { value, end }.
function readValue(lines, start, col) {
  let depth = 0;
  let quote = null;
  let out = "";
  let i = start;
  for (;;) {
    const line = bare(lines[i]);
    for (; col < line.length; col++) {
      const c = line[col];
      if (quote) {
        out += c;
        if (c === "\\" && quote === '"') out += line[++col] ?? "";
        else if (c === quote) quote = null;
        continue;
      }
      if (c === "#") break;
      if (c === '"' || c === "'") quote = c;
      else if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") depth--;
      out += c;
    }
    if (depth <= 0 || i + 1 >= lines.length) return { value: out.trim(), end: i };
    // Join the lines into one: the block holds the value on a single line.
    out = out.trimEnd();
    if (!out.endsWith("[") && !out.endsWith("{")) out += " ";
    quote = null;
    i++;
    col = lines[i].search(/\S|$/);
  }
}

const QUOTED = /"(?:[^"\\]|\\.)*"|'[^']*'/g;
const KEY_PART = String.raw`(?:"(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)`;
const KEY_LINE = new RegExp(String.raw`^\s*(${KEY_PART}(?:\s*\.\s*${KEY_PART})*)\s*=\s*`);

// The table headers and `key = value` lines of a config, enough to find a few
// keys: { section, line } for a header, { section, key, dotted, value, line, end } for
// a key. Multi-line strings are not understood.
function scan(lines) {
  const items = [];
  let section = "";
  for (let i = 0; i < lines.length; i++) {
    const line = bare(lines[i]);
    const header = /^\s*\[\s*([^[\]]+?)\s*\]\s*(#.*)?$/.exec(line);
    if (header) {
      section = header[1].replace(/\s*\.\s*/g, ".").replace(/["']/g, "");
      items.push({ section, line: i });
      continue;
    }
    if (/^\s*\[\[/.test(line)) {
      section = `[[${i}]]`;
      continue;
    }
    const kv = KEY_LINE.exec(line);
    if (!kv) continue;
    const { value, end } = readValue(lines, i, kv[0].length);
    // A dotted key (`a.b = 1`) keeps its full path and is marked { dotted: true }.
    const dotted = kv[1].replace(QUOTED, "").includes(".");
    const key = dotted ? kv[1].replace(/\s*\.\s*/g, ".").replace(/["']/g, "") : unquote(kv[1]);
    items.push({ section, key, dotted, value, line: i, end });
    i = end;
  }
  return items;
}

// --- the managed block ---------------------------------------------------

// Replaces the first array element "agent" (not `token = "agent"`), or null.
function replaceAgent(raw, replacement) {
  for (let i = 0; i < raw.length; i++) {
    const quote = raw[i];
    if (quote !== '"' && quote !== "'") continue;
    let j = i + 1;
    while (j < raw.length && raw[j] !== quote) j += raw[j] === "\\" && quote === '"' ? 2 : 1;
    const literal = raw.slice(i, j + 1);
    const before = raw.slice(0, i).trimEnd().slice(-1);
    const after = raw.slice(j + 1).trimStart()[0];
    if ((literal === '"agent"' || literal === "'agent'") && /[[,]/.test(before) && /[\],]/.test(after)) {
      return raw.slice(0, i) + replacement + raw.slice(j + 1);
    }
    i = j;
  }
  return null;
}

// herdr colors a token with the first rule whose `starts_with` matches (usage.js
// draws ● high, ◐ medium, ○ low). Without usable colors the item is plain.
function usageItem(slot, colors) {
  if (!colors) return `"$herdr_usage_${slot}"`;
  const rules = [["●", colors.red], ["◐", colors.yellow], ["○", colors.green]]
    .map(([glyph, fg]) => `{ starts_with = "${glyph}", fg = "${fg}" }`)
    .join(", ");
  return `{ token = "$herdr_usage_${slot}", rules = [${rules}] }`;
}

function rowsFor(baseRaw, colors, logoColor) {
  let rows = baseRaw;
  if (logoColor) rows = replaceAgent(rows, `{ token = "$herdr_usage_icon", fg = "${logoColor}" }, "agent"`) ?? rows;
  const usage = `[${usageItem(1, colors)}, ${usageItem(2, colors)}]`;
  const close = rows.lastIndexOf("]");
  const head = rows.slice(0, close).trimEnd();
  const sep = head.endsWith(",") ? " " : head.endsWith("[") ? "" : ", ";
  return `${head}${sep}${usage}${rows.slice(close)}`;
}

// What is wrong with the marker lines, as report lines, or null when the block is
// absent or whole (one START, then one END).
function blockProblem(text) {
  const lines = splitLines(text).map(bare);
  const at = (re) => lines.flatMap((l, i) => (re.test(l) ? [i + 1] : []));
  const starts = at(START_RE);
  const ends = at(END_RE);
  if (starts.length === 0 && ends.length === 0) return null;
  if (starts.length === 1 && ends.length === 1 && starts[0] < ends[0]) return null;
  const list = (name, found) => (found.length ? `${name} at line ${found.join(", ")}` : `no ${name}`);
  return [`${list('"# >>> herdr-usage"', starts)}; ${list('"# <<< herdr-usage"', ends)}`];
}

// Removes the lines we generated: the markers, our table header inside them, and the
// `<provider id> = ...` keys inside them. Any other line between the markers stays
// (herdr's own writer may have put a key of the previous table there). With no
// provider-generated extras, add + strip is the identity. A damaged block is left alone.
function stripBlock(text) {
  if (blockProblem(text)) return text;
  const lines = splitLines(text);
  const start = lines.findIndex((l) => START_RE.test(bare(l)));
  if (start < 0) return text;
  const end = lines.findIndex((l, i) => i > start && END_RE.test(bare(l)));
  const ours = new RegExp(String.raw`^(${PROVIDERS.map((p) => p.id).join("|")})\s*=`);
  const kept = lines.slice(start + 1, end).filter((l) => {
    const line = bare(l).trim();
    return line !== `[${SECTION}]` && !ours.test(line);
  });
  const out = [...lines.slice(0, start), ...kept, ...lines.slice(end + 1)];
  // A block that ends the file without a newline also carries the line break we
  // added to the line before it.
  if (end === lines.length - 1 && !/\n$/.test(lines[end]) && out.length > 0) out[out.length - 1] = bare(out[out.length - 1]);
  return out.join("");
}

// Adds the managed block for `providers` ([{ id, logoColor }]) to the config text.
// Returns { text, notes, hand }: the new text (the stripped text when no provider
// needs a key), report lines, and what to add by hand: { where, lines }.
function addBlock(original, { providers, colors }) {
  const text = stripBlock(original);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = splitLines(text);
  const items = scan(lines);
  // `rows` set by a dotted key: we cannot tell what herdr reads, so we do not guess.
  const dotted = items.find((i) => i.dotted && [i.section, i.key].filter(Boolean).join(".") === "ui.sidebar.agents.rows");
  if (dotted) {
    return {
      text: original,
      notes: [],
      decline: `herdr: your sidebar rows use the dotted key \`${dotted.key}\`, config.toml not edited; move them under [ui.sidebar.agents] as \`rows = ...\`, then run the herdr-usage.setup action`,
    };
  }
  const header = items.find((i) => i.key === undefined && i.section === SECTION);
  const baseRaw = items.find((i) => i.section === "ui.sidebar.agents" && i.key === "rows")?.value ?? DEFAULT_ROWS;
  const usable = colors && colors.green && colors.yellow && colors.red ? colors : null;
  const notes = [];
  const keys = [];
  for (const p of providers) {
    const mine = items.find((i) => i.section === SECTION && i.key === p.id);
    if (!mine) keys.push(`${p.id} = ${rowsFor(baseRaw, usable, p.logoColor)}`);
    else if (mine.value.includes("$herdr_usage_")) notes.push(`herdr: ${p.id} rows already show usage`);
    else notes.push(`herdr: ${p.id} rows kept (yours)`);
  }
  if (keys.length === 0) return { text, notes, hand: null };

  const body = header ? [START, ...keys, END] : [START, `[${SECTION}]`, ...keys, END];
  const hand = header
    ? { where: `under [${SECTION}]`, lines: keys }
    : { where: "at the end", lines: body.slice(1, -1) };
  let head = lines;
  let tail = [];
  if (header) {
    head = lines.slice(0, header.line + 1);
    tail = lines.slice(header.line + 1);
  }
  // The block ends the file without a newline when the text did not have one.
  const last = head[head.length - 1];
  const open = tail.length === 0 && last !== undefined && !/\n$/.test(last);
  if (open) head = [...head.slice(0, -1), last + eol];
  const block = body.map((l, i) => (open && i === body.length - 1 ? l : l + eol));
  return { text: [...head, ...block, ...tail].join(""), notes, hand };
}

// --- icon ----------------------------------------------------------------

// The logo needs the font in the terminal. macOS and Linux terminals fall back to
// it on their own; Windows Terminal needs it in the font face, which we only read.
function iconEnabled(env = process.env, platform = process.platform) {
  if (platform !== "win32") return true;
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  return WINDOWS_TERMINAL_DIRS.some((dir) => {
    try {
      return fs.readFileSync(path.join(local, ...dir, "settings.json"), "utf8").includes("HerdrUsageIcons");
    } catch {
      return false;
    }
  });
}

// --- editing the file ----------------------------------------------------

// "ok", "bad" (herdr found problems) or "unavailable" (herdr could not run).
function check(file, env, exec) {
  try {
    exec(herdrBin(env), ["config", "check"], { HERDR_CONFIG_PATH: file });
    return "ok";
  } catch (err) {
    return err && typeof err.status === "number" ? "bad" : "unavailable";
  }
}

// Replaces config.toml with transform(original).text. With `validate`, herdr checks
// the original and the new file first (we only remove our own lines when we undo, which
// cannot add problems, so that edit skips the check). A declined edit always prints
// what to do by hand. Returns { lines, changed, same, text }: `same` when nothing
// needs to change.
function editConfig(env, exec, platform, transform, { validate = true } = {}) {
  const file = paths.herdrConfigFile(env, platform);
  const exists = fs.existsSync(file);
  const original = exists ? fs.readFileSync(file, "utf8") : "";
  const problem = blockProblem(original);
  if (problem) {
    const lines = ["herdr: managed block in config.toml is damaged; fix it by hand", ...problem.map((l) => `  ${l}`)];
    return { lines, changed: false, same: false, text: original };
  }
  const { text, notes, hand, decline } = transform(original);
  const lines = [...notes];
  if (decline) return { lines: [...lines, decline], changed: false, same: false, text: original };
  if (text === original) return { lines, changed: false, same: true, text };

  const byHand = (why) => {
    lines.push(`herdr: ${why}`);
    lines.push(`herdr: by hand: ${hand.verb} ${hand.where} in ${file}${hand.lines.length ? ":" : ""}`);
    lines.push(...hand.lines.map((l) => `  ${l}`));
    return { lines, changed: false, same: false, text: original };
  };
  if (exists && validate) {
    const state = check(file, env, exec);
    if (state === "bad") return byHand("config.toml has problems, not edited; run herdr config check");
    if (state === "unavailable") return byHand("could not run herdr to validate, config.toml not edited");
  } else if (!exists) {
    lines.push(`herdr: ${file} not found, creating it`);
  }

  let target = file;
  try {
    target = fs.realpathSync(file);
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const tmp = `${target}.${process.pid}.herdr-usage.tmp`;
  fs.writeFileSync(tmp, text);
  try {
    if (exists) fs.chmodSync(tmp, fs.statSync(target).mode & 0o7777);
  } catch {
    // keep the default mode where chmod is not supported
  }
  if (validate) {
    const state = check(tmp, env, exec);
    if (state !== "ok") {
      fs.rmSync(tmp, { force: true });
      return byHand(
        state === "bad"
          ? "the new rows failed herdr config check, config.toml not edited"
          : "could not run herdr to validate, config.toml not edited",
      );
    }
  }
  const backup = `${file}.herdr-usage.bak`;
  if (exists && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
  fs.renameSync(tmp, target);
  return { lines, changed: true, same: false, text };
}

function providerRows(env, platform) {
  const logo = iconEnabled(env, platform);
  return PROVIDERS.map((p) => ({ id: p.id, logoColor: logo && icons[p.id] ? icons[p.id].color : null }));
}

// Adds (or regenerates) the managed block. Returns { lines, changed }.
function setupRows(env = process.env, { exec = run, platform = process.platform } = {}) {
  const lines = [];
  if (!iconEnabled(env, platform)) lines.push(WINDOWS_TERMINAL_HINT);
  const providers = providerRows(env, platform);
  const file = paths.herdrConfigFile(env, platform);
  const result = editConfig(env, exec, platform, (original) => {
    const out = addBlock(original, { providers, colors: themeColors(original) });
    out.hand = out.hand && { verb: "add", ...out.hand };
    return out;
  });
  lines.push(...result.lines);
  if (result.changed) lines.push(`herdr: sidebar rows set (${file})`);
  else if (result.same && stripBlock(result.text) !== result.text) lines.push("herdr: config.toml already set up");
  return { lines, changed: result.changed };
}

// Removes the managed block. Returns { lines, changed }.
function removeRows(env = process.env, { exec = run, platform = process.platform } = {}) {
  const file = paths.herdrConfigFile(env, platform);
  const result = editConfig(env, exec, platform, (original) => ({
    text: stripBlock(original),
    notes: [],
    hand: { verb: "remove", where: `the lines from "# >>> herdr-usage" to "# <<< herdr-usage"`, lines: [] },
  }), { validate: false });
  if (result.changed) result.lines.push(`herdr: sidebar rows removed (${file})`);
  else if (result.lines.length === 0) result.lines.push("herdr: no managed rows in config.toml");
  return result;
}

// Best effort: fails when no herdr server runs, which is fine.
function reloadConfig(env = process.env, exec = run) {
  try {
    exec(herdrBin(env), ["server", "reload-config"]);
  } catch {
    // no running server: it reads the file on start
  }
}

module.exports = { themeColors, addBlock, stripBlock, blockProblem, iconEnabled, setupRows, removeRows, reloadConfig, START, END };
