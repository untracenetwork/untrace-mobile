#!/usr/bin/env node
// Download the compiled Untrace core pinned in core.lock, then verify it
// (SHA-256 against core.lock AND the minisign signature on SHA256SUMS)
// before anything uses it. No core source is ever fetched: binaries only.
// Usage: node scripts/fetch-core.mjs <target> [<target> ...]
import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const lock = Object.fromEntries(
  readFileSync(new URL("../core.lock", import.meta.url), "utf8")
    .split("\n").map((l) => l.match(/^\s*([\w.-]+)\s*=\s*"(.*)"\s*$/)).filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const base = `${lock.base_url}/v${lock.core_version}`;
const get = async (name) => {
  const r = await fetch(`${base}/${name}`);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};

// minisign (prehashed Ed25519, BLAKE2b-512), Tauri base64 wrapping.
function minisignVerify(pubB64, file, sigB64) {
  const pk = Buffer.from(Buffer.from(pubB64, "base64").toString().split("\n")[1], "base64");
  const lines = Buffer.from(sigB64.toString().trim(), "base64").toString().split("\n");
  const sig = Buffer.from(lines[1], "base64");
  const trusted = lines[2].slice("trusted comment: ".length);
  const glob = Buffer.from(lines[3], "base64");
  if (sig.subarray(0, 2).toString() !== "ED" || !sig.subarray(2, 10).equals(pk.subarray(2, 10)))
    throw new Error("signature key id mismatch");
  const key = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pk.subarray(10)]),
    format: "der", type: "spki",
  });
  const h = createHash("blake2b512").update(file).digest();
  if (!verify(null, h, key, sig.subarray(10)) ||
      !verify(null, Buffer.concat([sig.subarray(10), Buffer.from(trusted)]), key, glob))
    throw new Error("BAD signature");
  return trusted;
}

const targets = process.argv.slice(2);
if (!targets.length) { console.error("usage: fetch-core.mjs <target>..."); process.exit(2); }
const sums = await get("SHA256SUMS");
console.log("SHA256SUMS:", minisignVerify(lock.signing_key, sums, await get("SHA256SUMS.sig")));
mkdirSync("vendor/untrace-core", { recursive: true });
for (const t of targets) {
  const name = `untrace-core-${lock.core_version}-${t}.tar.gz`;
  const pinned = lock[`sha256.${t}`];
  const listed = sums.toString().split("\n").find((l) => l.endsWith(` ${name}`))?.split(" ")[0];
  const buf = await get(name);
  const got = createHash("sha256").update(buf).digest("hex");
  if (!pinned || got !== pinned || got !== listed) throw new Error(`${name}: digest mismatch`);
  writeFileSync(join("vendor/untrace-core", name), buf);
  console.log("verified", name);
}
