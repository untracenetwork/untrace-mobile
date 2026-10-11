// Config plugin: at `expo prebuild`, fetch + verify the pinned core binary
// (scripts/fetch-core.mjs) and place it for the native module
// (scripts/place-core.mjs). Nothing is committed; vendor/ and the placed
// libraries are gitignored.
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");
const { withDangerousMod } = require("expo/config-plugins");

function place(projectRoot, platform) {
  execFileSync(process.execPath, [join(projectRoot, "scripts", "place-core.mjs"), platform], {
    cwd: projectRoot,
    stdio: "inherit",
  });
}

module.exports = function withUntraceCore(config) {
  config = withDangerousMod(config, ["ios", (c) => (place(c.modRequest.projectRoot, "ios"), c)]);
  config = withDangerousMod(config, ["android", (c) => (place(c.modRequest.projectRoot, "android"), c)]);
  return config;
};
