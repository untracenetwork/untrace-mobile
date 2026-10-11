// The ONLY door to the Untrace core. Keys, signatures, encryption, splitting
// and rebuilding all happen inside the compiled, signed core binary (pinned
// in core.lock, verified by scripts/fetch-core.mjs). This file holds no
// crypto and has no fallback: without the native module every call throws.
import { requireOptionalNativeModule } from "expo";

type Native = {
  version(): string;
  prfInput(index: number): Uint8Array;
  signIn(prf: Uint8Array): string;
  signOut(): void;
  signAuth(nonce: string, issuedAt: string, op: string, resource: string, message: string): string;
  seal(plain: Uint8Array, k: number, n: number): Promise<Uint8Array>;
  open(framed: Uint8Array): Promise<Uint8Array>;
  sha256Hex(data: Uint8Array): string;
  uuidV4(): string;
};

const native = requireOptionalNativeModule<Native>("UntraceCore");

function core(): Native {
  if (!native) throw new Error("Untrace core is not linked in this build");
  return native;
}

export type CoreStatus = { linked: false } | { linked: true; version: string };

export function coreStatus(): CoreStatus {
  try {
    return native ? { linked: true, version: native.version() } : { linked: false };
  } catch {
    return { linked: false };
  }
}

/** PRF input for account `index` (0 = primary). Pass it to the passkey as is. */
export const prfInput = (index = 0): Uint8Array => core().prfInput(index);

/** Hand the passkey PRF output to the core. Returns the wallet (account id). */
export const signIn = (prf: Uint8Array): string => core().signIn(prf);

export const signOut = (): void => core().signOut();

/**
 * Sign a Drive auth nonce. The core rebuilds the message itself and refuses
 * anything that is not a Drive auth message. Empty op/resource = v1.
 */
export const signAuth = (
  nonce: string,
  issuedAt: string,
  message: string,
  op = "",
  resource = "",
): string => core().signAuth(nonce, issuedAt, op, resource, message);

/** Seal a file for this account into `n` shards, any `k` rebuild it. */
export async function seal(plain: Uint8Array, k: number, n: number): Promise<Uint8Array[]> {
  return unframe(await core().seal(plain, k, n));
}

/** Rebuild a file from any `k` of its shards. */
export async function open(shards: Uint8Array[]): Promise<Uint8Array> {
  return core().open(frame(shards));
}

export const sha256Hex = (data: Uint8Array): string => core().sha256Hex(data);
export const uuidV4 = (): string => core().uuidV4();

// Transport framing only (u32 little-endian length before each shard), the
// way the core's C ABI passes a list of shards in one buffer.
function frame(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + 4 + p.length, 0));
  const view = new DataView(out.buffer);
  let o = 0;
  for (const p of parts) {
    view.setUint32(o, p.length, true);
    out.set(p, o + 4);
    o += 4 + p.length;
  }
  return out;
}

function unframe(buf: Uint8Array): Uint8Array[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const parts: Uint8Array[] = [];
  let o = 0;
  while (o < buf.length) {
    if (o + 4 > buf.length) throw new Error("core returned a bad shard list");
    const len = view.getUint32(o, true);
    if (o + 4 + len > buf.length) throw new Error("core returned a bad shard list");
    parts.push(buf.slice(o + 4, o + 4 + len));
    o += 4 + len;
  }
  return parts;
}
