// Passkey sign-in. The authenticator's PRF output goes straight to the core,
// which keeps the account seed in native memory and returns the wallet.
import { getRandomBytes } from "expo-crypto";
import * as Passkeys from "react-native-passkeys";
import * as core from "../core";

export const RP_ID = "untrace.network";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toB64url(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < b.length) s += B64[(n >> 6) & 63];
    if (i + 2 < b.length) s += B64[n & 63];
  }
  return s;
}

export function fromB64url(s: string): Uint8Array {
  const clean = s.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error("bad base64url");
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
    }
  }
  return new Uint8Array(out);
}

/** Ask for a passkey on untrace.network with PRF; returns the wallet. */
export async function signInWithPasskey(accountIndex = 0): Promise<string> {
  if (!Passkeys.isSupported()) throw new Error("Passkeys are not supported on this device.");
  const res = await Passkeys.get({
    rpId: RP_ID,
    challenge: toB64url(getRandomBytes(32)),
    userVerification: "required",
    timeout: 60000,
    extensions: { prf: { eval: { first: toB64url(core.prfInput(accountIndex)) } } },
  });
  if (!res) throw new Error("Sign-in was cancelled.");
  const first = res.clientExtensionResults?.prf?.results?.first;
  if (!first) throw new Error("This passkey did not return a PRF secret. Use a passkey made at drive.untrace.network.");
  return core.signIn(fromB64url(first));
}
