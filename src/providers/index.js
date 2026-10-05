// Every usage provider. Each src/providers/<id>.js exports one object:
//
//   {
//     id,                // herdr agent id (`herdr agent list` .agent)
//     configDir(env),    // the tool's config dir; install/uninstall skip the provider when it is missing
//     read(env),         // -> UsageState (src/usage.js); may throw, readAll isolates it
//     install(env),      // -> string[] lines "<id>: ...", idempotent
//     uninstall(env),    // -> string[] lines
//     hooks: { "<cli subcommand>": (input, ctx) => void },  // commands the tool runs
//     ...data helpers used by tests
//   }
//
// A hook gets the stdin text and ctx = { env, now(), write(text), publish({ throttle }) }.
// Hook names must not match a built-in command (status, publish, install, ...).
// `write` prints to stdout at once; `publish()` pushes usage to herdr (only inside
// herdr), and `publish({ throttle: true })` skips it when nothing changed recently.
//
// To add a provider:
//   1. write src/providers/<id>.js with that contract,
//   2. list it in PROVIDERS below,
//   3. optional logo: add assets/<id>.svg and an entry in assets/icons.json,
//      then rebuild the font (uv run tools/build-font.py).
// Each tool needs its own refresh trigger (its `install` and `hooks`), because
// every agent exposes a different hook.

const { unavailable } = require("../usage");
const claude = require("./claude");
const codex = require("./codex");

const PROVIDERS = [claude, codex];

// One provider failing never hides the others.
function readAll(env = process.env) {
  return PROVIDERS.map((p) => {
    try {
      return p.read(env);
    } catch (err) {
      return unavailable(p.id, `read failed: ${err.message}`);
    }
  });
}

// Hook handlers of all providers, by CLI subcommand name.
function hookHandlers() {
  return Object.assign({}, ...PROVIDERS.map((p) => p.hooks));
}

module.exports = { PROVIDERS, readAll, hookHandlers };
