// Wires herdr-usage into every provider's tool (see src/providers/index.js).
//
// Each provider's edits are idempotent, keep the original file as *.herdr-usage.bak,
// and keep foreign configuration: an existing Claude statusLine is chained, not
// replaced, and other Codex hooks are left untouched.

const fs = require("node:fs");
const { PROVIDERS } = require("./providers");

// Runs each provider on its own: one tool's broken config does not block the
// other, and a tool that is not installed is skipped instead of getting a new config.
function runAll(action, env) {
  return PROVIDERS.flatMap((p) => {
    try {
      const dir = p.configDir(env);
      if (!fs.existsSync(dir)) return [`${p.id}: skipped (${dir} not found)`];
      return p[action](env);
    } catch (err) {
      return [`${p.id}: error: ${err.message}`];
    }
  });
}

const install = (env = process.env) => runAll("install", env);
const uninstall = (env = process.env) => runAll("uninstall", env);

module.exports = { install, uninstall };
