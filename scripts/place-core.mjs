#!/usr/bin/env node
// Put the verified core binaries where the native module links them.
// Runs fetch-core.mjs first (SHA-256 + signature check), then:
//   ios:     modules/untrace-core/ios/UntraceCoreFFI.xcframework
//            (device + simulator static libs; built with Xcode, macOS only)
//   android: modules/untrace-core/android/src/main/jniLibs/<abi>/libuntrace_core.so
// Everything placed here is gitignored and never published.
// Usage: node scripts/place-core.mjs [ios] [android]   (default: both)
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const version = readFileSync(join(root, "core.lock"), "utf8").match(/^core_version\s*=\s*"(.+)"/m)[1];
const want = process.argv.slice(2).length ? process.argv.slice(2) : ["ios", "android"];
const vendor = join(root, "vendor", "untrace-core");
const mod = join(root, "modules", "untrace-core");

const IOS = ["aarch64-apple-ios", "aarch64-apple-ios-sim"];
const ANDROID = { "aarch64-linux-android": "arm64-v8a", "x86_64-linux-android": "x86_64" };

const targets = [
  ...(want.includes("ios") ? IOS : []),
  ...(want.includes("android") ? Object.keys(ANDROID) : []),
];
execFileSync(process.execPath, [join(root, "scripts", "fetch-core.mjs"), ...targets], { cwd: root, stdio: "inherit" });

const unpack = (t) => {
  const dir = join(vendor, `untrace-core-${version}-${t}`);
  rmSync(dir, { recursive: true, force: true });
  execFileSync("tar", ["xzf", `untrace-core-${version}-${t}.tar.gz`], { cwd: vendor });
  return dir;
};

if (want.includes("android")) {
  for (const [t, abi] of Object.entries(ANDROID)) {
    const out = join(mod, "android", "src", "main", "jniLibs", abi);
    mkdirSync(out, { recursive: true });
    copyFileSync(join(unpack(t), "libuntrace_core.so"), join(out, "libuntrace_core.so"));
    console.log("placed", abi);
  }
}

if (want.includes("ios")) {
  const xcf = join(mod, "ios", "UntraceCoreFFI.xcframework");
  if (process.platform !== "darwin") {
    console.log("skip ios: xcframework needs Xcode (macOS)");
  } else {
    // Libraries only: Swift sees the C declarations through the pod's own
    // header (ios/UntraceCoreBridge.h), so no module map is needed here.
    const args = ["-create-xcframework"];
    for (const t of IOS) args.push("-library", join(unpack(t), "libuntrace_core.a"));
    rmSync(xcf, { recursive: true, force: true });
    execFileSync("xcodebuild", [...args, "-output", xcf], { stdio: "inherit" });
    if (!existsSync(xcf)) throw new Error("xcframework not created");
    console.log("placed", xcf);
  }
}
