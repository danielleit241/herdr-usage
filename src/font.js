// Installs fonts/HerdrUsageIcons.ttf for the current user, so the terminal can
// draw the provider logos of the $herdr_usage_icon token. No admin rights.
//
//   macOS    ~/Library/Fonts
//   Linux    $XDG_DATA_HOME/fonts (default ~/.local/share/fonts), then fc-cache
//   Windows  %LOCALAPPDATA%\Microsoft\Windows\Fonts, its HKCU registry entry, then
//            AddFontResource + WM_FONTCHANGE like the Explorer "Install" command

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const FILE = "HerdrUsageIcons.ttf";
const SOURCE = path.join(__dirname, "..", "fonts", FILE);
const WIN_FONTS_KEY = "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";
const WIN_FONT_NAME = "HerdrUsageIcons Regular (TrueType)";
// Left by 0.2.0, which shipped a CFF font.
const OLD_FILE = "HerdrUsageIcons.otf";
const OLD_WIN_FONT_NAME = "HerdrUsageIcons Regular (OpenType)";

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

// Removes one installed font file. Windows keeps a loaded font locked until it
// is unloaded or the apps using it quit.
function removeFont(target, platform, exec, regName, lines) {
  if (platform === "win32") {
    tryExec(() => winFontResource(exec, "remove", target));
    tryExec(() => exec("reg", ["delete", WIN_FONTS_KEY, "/v", regName, "/f"]));
  }
  if (!fs.existsSync(target)) return;
  try {
    fs.rmSync(target, { force: true });
    lines.push(`font: removed ${target}`);
  } catch (err) {
    lines.push(`font: could not remove ${target} (${err.code}); quit the terminal and run this again`);
  }
}

const RESTART = "Fully quit and reopen your terminal app so it loads the font.";

function installFont(env = process.env, platform = process.platform, exec = run) {
  const dir = fontDir(env, platform);
  const target = path.join(dir, FILE);
  const lines = [];
  removeFont(path.join(dir, OLD_FILE), platform, exec, OLD_WIN_FONT_NAME, lines);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(SOURCE, target);
  if (platform === "win32") {
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
  removeFont(path.join(dir, FILE), platform, exec, WIN_FONT_NAME, lines);
  removeFont(path.join(dir, OLD_FILE), platform, exec, OLD_WIN_FONT_NAME, lines);
  if (platform !== "win32" && platform !== "darwin") tryExec(() => exec("fc-cache", ["-f", dir]));
  return lines.length ? lines : ["font: not installed"];
}

module.exports = { fontDir, installFont, uninstallFont, WIN_FONT_NAME };
