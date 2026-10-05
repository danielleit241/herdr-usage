// Runs a program without a shell and without output. `env` is merged over the
// current environment. Throws on a non-zero exit. Injected into the setup code
// (font, herdr config) so tests never start a real program.

const { execFileSync } = require("node:child_process");

function run(file, args, env) {
  execFileSync(file, args, { stdio: "ignore", windowsHide: true, timeout: 30_000, env: { ...process.env, ...env } });
}

module.exports = { run };
