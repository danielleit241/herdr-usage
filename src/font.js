// Installs fonts/HerdrUsageIcons.otf for the current user, so the terminal can
// draw the provider logos of the $herdr_usage_icon token. No admin rights.
//
//   macOS    ~/Library/Fonts
//   Linux    $XDG_DATA_HOME/fonts (default ~/.local/share/fonts), then fc-cache
//   Windows  %LOCALAPPDATA%\Microsoft\Windows\Fonts plus its HKCU registry entry

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const FILE = "HerdrUsageIcons.otf";
const SOURCE = path.join(__dirname, "..", "fonts", FILE);
const WIN_FONTS_KEY = "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";
const WIN_FONT_NAME = "HerdrUsageIcons Regular (OpenType)";

function fontDir(env = process.env, platform = process.platform) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  if (platform === "darwin") return path.join(home, "Library", "Fonts");
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(local, "Microsoft", "Windows", "Fonts");
  }
  return path.join(env.XDG_DATA_HOME || path.join(home, ".local", "share"), "fonts");
}

function run(file, args) {
  execFileSync(file, args, { stdio: "ignore", windowsHide: true, timeout: 30_000 });
}

const RESTART = "Fully quit and reopen your terminal app so it loads the font.";

function installFont(env = process.env, platform = process.platform, exec = run) {
  const target = path.join(fontDir(env, platform), FILE);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(SOURCE, target);
  if (platform === "win32") {
    exec("reg", ["add", WIN_FONTS_KEY, "/v", WIN_FONT_NAME, "/t", "REG_SZ", "/d", target, "/f"]);
  } else if (platform !== "darwin") {
    try {
      exec("fc-cache", ["-f", path.dirname(target)]);
    } catch {
      // fontconfig is optional; most terminals rescan the directory on start
    }
  }
  return [`font: installed ${target}`, RESTART];
}

function uninstallFont(env = process.env, platform = process.platform, exec = run) {
  const target = path.join(fontDir(env, platform), FILE);
  const lines = [];
  if (platform === "win32") {
    try {
      exec("reg", ["delete", WIN_FONTS_KEY, "/v", WIN_FONT_NAME, "/f"]);
    } catch {
      // not registered
    }
  }
  try {
    fs.rmSync(target, { force: true });
    lines.push(`font: removed ${target}`);
  } catch (err) {
    // Windows keeps a loaded font file locked until the apps using it quit.
    lines.push(`font: could not remove ${target} (${err.code}); quit the terminal and run this again`);
  }
  if (platform !== "win32" && platform !== "darwin") {
    try {
      exec("fc-cache", ["-f", path.dirname(target)]);
    } catch {
      // fontconfig is optional
    }
  }
  return lines;
}

module.exports = { fontDir, installFont, uninstallFont, WIN_FONT_NAME };
