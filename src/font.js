// Installs fonts/HerdrUsageIcons.ttf for the current user, so the terminal can
// draw the provider logos of the $herdr_usage_icon token. No admin rights.
//
//   macOS    ~/Library/Fonts
//   Linux    $XDG_DATA_HOME/fonts (default ~/.local/share/fonts), then fc-cache
//   Windows  %LOCALAPPDATA%\Microsoft\Windows\Fonts, its HKCU registry entry, then
//            AddFontResource + WM_FONTCHANGE like the Explorer "Install" command
//
// The file is installed under a content-hashed name: a terminal keeps the font
// it loaded locked, so an update writes a new file instead of overwriting it.

const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SOURCE = path.join(__dirname, "..", "fonts", "HerdrUsageIcons.ttf");
// Every font file this plugin has installed: hashed .ttf, and 0.2.0's .otf.
const OWNED = /^HerdrUsageIcons(-[0-9a-f]{8})?\.(ttf|otf)$/;
const WIN_FONTS_KEY = "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";
const WIN_FONT_NAME = "HerdrUsageIcons Regular (TrueType)";
const OLD_WIN_FONT_NAME = "HerdrUsageIcons Regular (OpenType)"; // 0.2.0

// Loads (or unloads) the font in the session and tells running apps that the
// font list changed. The path comes in through the environment, not the script.
const WIN_FONT_RESOURCE = `
$t = Add-Type -Name Font -Namespace HerdrUsage -PassThru -MemberDefinition @'
[DllImport("gdi32.dll", CharSet = CharSet.Unicode)] public static extern int AddFontResourceW(string file);
[DllImport("gdi32.dll", CharSet = CharSet.Unicode)] public static extern bool RemoveFontResourceW(string file);
[DllImport("user32.dll")] public static extern IntPtr SendMessageTimeoutW(IntPtr hwnd, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
'@
if ($env:HERDR_USAGE_FONT_OP -eq 'add') { [void]$t::AddFontResourceW($env:HERDR_USAGE_FONT) } else { [void]$t::RemoveFontResourceW($env:HERDR_USAGE_FONT) }
$r = [IntPtr]::Zero
[void]$t::SendMessageTimeoutW([IntPtr]0xffff, 0x1D, [IntPtr]::Zero, [IntPtr]::Zero, 2, 1000, [ref]$r)
`;

function fontDir(env = process.env, platform = process.platform) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  if (platform === "darwin") return path.join(home, "Library", "Fonts");
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(local, "Microsoft", "Windows", "Fonts");
  }
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "fonts");
}

function installedName() {
  const hash = crypto.createHash("sha256").update(fs.readFileSync(SOURCE)).digest("hex").slice(0, 8);
  return `HerdrUsageIcons-${hash}.ttf`;
}

function ownedFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((name) => OWNED.test(name));
  } catch {
    return [];
  }
}

function run(file, args, env) {
  execFileSync(file, args, { stdio: "ignore", windowsHide: true, timeout: 30_000, env: { ...process.env, ...env } });
}

function winFontResource(exec, op, file) {
  exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WIN_FONT_RESOURCE], {
    HERDR_USAGE_FONT_OP: op,
    HERDR_USAGE_FONT: file,
  });
}

function tryExec(fn) {
  try {
    fn();
  } catch {
    // best effort: the step is optional or the thing is already gone
  }
}

// Unloads and deletes one font file. A file still locked by a running terminal
// stays; the next install or uninstall removes it.
function removeFile(file, platform, exec, lines) {
  if (platform === "win32") tryExec(() => winFontResource(exec, "remove", file));
  try {
    fs.rmSync(file, { force: true });
    lines.push(`font: removed ${file}`);
  } catch (err) {
    lines.push(`font: ${file} is in use (${err.code}); it is removed on the next run`);
  }
}

const RESTART = "Fully quit and reopen your terminal app so it loads the font.";

function installFont(env = process.env, platform = process.platform, exec = run) {
  const dir = fontDir(env, platform);
  const name = installedName();
  const target = path.join(dir, name);
  const lines = [];
  for (const old of ownedFiles(dir)) if (old !== name) removeFile(path.join(dir, old), platform, exec, lines);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(target)) fs.copyFileSync(SOURCE, target);
  if (platform === "win32") {
    tryExec(() => exec("reg", ["delete", WIN_FONTS_KEY, "/v", OLD_WIN_FONT_NAME, "/f"]));
    exec("reg", ["add", WIN_FONTS_KEY, "/v", WIN_FONT_NAME, "/t", "REG_SZ", "/d", target, "/f"]);
    tryExec(() => winFontResource(exec, "add", target));
  } else if (platform !== "darwin") {
    // fontconfig is optional; most terminals rescan the directory on start
    tryExec(() => exec("fc-cache", ["-f", dir]));
  }
  return [...lines, `font: installed ${target}`, RESTART];
}

function uninstallFont(env = process.env, platform = process.platform, exec = run) {
  const dir = fontDir(env, platform);
  const lines = [];
  if (platform === "win32") {
    for (const regName of [WIN_FONT_NAME, OLD_WIN_FONT_NAME]) {
      tryExec(() => exec("reg", ["delete", WIN_FONTS_KEY, "/v", regName, "/f"]));
    }
  }
  for (const file of ownedFiles(dir)) removeFile(path.join(dir, file), platform, exec, lines);
  if (platform !== "win32" && platform !== "darwin") tryExec(() => exec("fc-cache", ["-f", dir]));
  return lines.length ? lines : ["font: not installed"];
}

module.exports = { fontDir, installFont, uninstallFont, WIN_FONT_NAME };
