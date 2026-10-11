// The ONLY door to the Untrace core. Encryption, splitting and rebuilding
// happen inside the compiled, signed core binary (see core.lock and
// scripts/fetch-core.mjs). This file holds no crypto: it only forwards calls
// to the native module that wraps that binary.
//
// Native module status: not wired yet. Until it is, every call throws, so
// the app can never fall back to a JavaScript reimplementation.

export type CoreStatus = { linked: false } | { linked: true; version: string };

export function coreStatus(): CoreStatus {
  return { linked: false };
}

function notLinked(): never {
  throw new Error("Untrace core binary not linked in this build");
}

export async function sealFile(_plain: Uint8Array, _k: number, _n: number): Promise<Uint8Array[]> {
  return notLinked();
}

export async function openFile(_shards: Uint8Array[]): Promise<Uint8Array> {
  return notLinked();
}
