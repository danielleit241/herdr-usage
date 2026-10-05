// Every usage provider. To add one:
//   1. write src/providers/<id>.js that returns a UsageState (src/usage.js),
//   2. add it below; `id` is the agent id that `herdr agent list` reports,
//   3. optional logo: add assets/<id>.svg and an entry in assets/icons.json,
//      then rebuild the font (uv run tools/build-font.py).
// Each tool still needs its own refresh trigger (src/install.js), because every
// agent exposes a different hook.

const paths = require("../paths");
const { unavailable } = require("../usage");
const claude = require("./claude");
const codex = require("./codex");

const PROVIDERS = [
  { id: "claude", read: (env) => claude.read(paths.claudeCachePath(env)) },
  { id: "codex", read: (env) => codex.read(paths.codexHome(env)) },
];

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

module.exports = { PROVIDERS, readAll };
