// Drive HTTP client, same endpoints as the Drive web app. Every signature
// comes from the core;
// every shard is sealed and opened by the core.
import * as core from "../core";

export const DRIVE = "https://drive.untrace.network";
const MAX_FILE_BYTES = 95 * 1024 * 1024;

export type Envelope = { wallet: string; nonce: string; signature: string; issuedAt: string };
export type DriveFile = { file_id: string; name: string; size: number; mime: string; created_at: string };
type Node = { index: number; url: string };
type Topology = { k: number; n: number; nodes: Node[] };
type ShardToken = { nodeIndex: number; shardIndex: number; sha256?: string | null; token: string };
type Opened = {
  name: string; mime: string; nonce: string; issuedAt: string;
  scheme?: string; sssK?: number; nodes: ShardToken[]; fallbackNodes?: ShardToken[];
};

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function send(what: string, url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error(`${what}: network error`);
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json())?.message ?? msg; } catch {}
    throw new HttpError(res.status, `${what}: ${msg}`);
  }
  return res;
}

// Signed envelopes and shard tokens only ever go over https.
function httpsOnly(what: string, url: string): void {
  if (!/^https:\/\/[^/]/i.test(url)) throw new Error(`${what} must use https`);
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export class Drive {
  constructor(public wallet: string, private base = DRIVE) { httpsOnly("Drive", base); }

  /** v1 envelope (purpose upload/download) or v2 bound to op + resource. */
  async envelope(purpose: string, op = "", resource = ""): Promise<Envelope> {
    const body: Record<string, string> = { wallet: this.wallet, purpose };
    if (op) Object.assign(body, { op, resource });
    const v = await (await send("nonce", `${this.base}/api/auth/nonce`, json(body))).json();
    if (typeof v?.nonce !== "string" || typeof v?.issuedAt !== "string" || typeof v?.message !== "string")
      throw new Error("nonce: bad response");
    // The core rebuilds the message and refuses if the server's differs.
    const signature = core.signAuth(v.nonce, v.issuedAt, v.message, op, resource);
    return { wallet: this.wallet, nonce: v.nonce, signature, issuedAt: v.issuedAt };
  }

  private static query(e: Envelope): string {
    return new URLSearchParams(e).toString();
  }

  async topology(): Promise<Topology> {
    const t: Topology = await (await send("topology", `${this.base}/api/nodes/config`, json(await this.envelope("download")))).json();
    if (!t || !Array.isArray(t.nodes) || t.nodes.length !== t.n || t.k < 1 || t.k > t.n)
      throw new Error("invalid topology");
    const seen = new Set<number>();
    for (const n of t.nodes) {
      if (seen.has(n.index)) throw new Error("invalid topology");
      seen.add(n.index);
      httpsOnly(`node${n.index}`, n.url);
    }
    return t;
  }

  async list(): Promise<DriveFile[]> {
    const e = await this.envelope("download");
    const v = await (await send("list", `${this.base}/api/files?${Drive.query(e)}`)).json();
    return Array.isArray(v?.files) ? v.files : [];
  }

  /** Seal in the core, register, push every shard, finalize. */
  async upload(name: string, mime: string, plain: Uint8Array, onStep?: (s: string) => void): Promise<string> {
    if (plain.length > MAX_FILE_BYTES) throw new Error("file is larger than the 95 MB limit");
    const topo = await this.topology();
    onStep?.("sealing");
    const shards = await core.seal(plain, topo.k, topo.n);
    if (shards.length !== topo.nodes.length) throw new Error("core returned the wrong shard count");
    const hashes = shards.map((s) => core.sha256Hex(s));
    const keyCommitment = core.sha256Hex(new TextEncoder().encode(hashes.join("")));
    const fileId = core.uuidV4();
    const manifest = shards.map((s, i) => ({ shardIndex: topo.nodes[i].index, sha256: hashes[i], byteSize: s.length }));
    const reg = await (await send("register", `${this.base}/api/files`, json({
      ...(await this.envelope("upload")),
      fileId, name, size: plain.length, mime: mime || "application/octet-stream",
      keyCommitment, scheme: "rs", shards: manifest,
    }))).json();
    const tokens: Record<string, string> = reg?.uploadTokens ?? {};

    onStep?.("uploading");
    const results = await Promise.allSettled(shards.map((shard, i) => {
      const node = topo.nodes[i];
      const token = tokens[String(node.index)];
      if (!token) return Promise.reject(new Error(`node${node.index}: no upload token`));
      return putShard(node, token, shard, hashes[i]);
    }));
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed.length) {
      await this.remove(fileId).catch(() => {});
      throw new Error(`upload failed: ${failed.length} of ${shards.length} shards did not land`);
    }
    await send("finalize", `${this.base}/api/files/${fileId}/finalize`, json(await this.envelope("upload")));
    return fileId;
  }

  async remove(fileId: string): Promise<void> {
    const resource = `/api/files/${fileId}`;
    const e = await this.envelope("settings-write", "DELETE", resource);
    await send("delete", `${this.base}${resource}`, {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(e),
    });
  }

  /** Fetch >= k shards (primaries, then spares), open in the core. */
  async download(fileId: string, onStep?: (s: string) => void): Promise<{ name: string; mime: string; plain: Uint8Array }> {
    const topo = await this.topology();
    const opened: Opened = await (await send("open", `${this.base}/api/files/${fileId}/open`, json(await this.envelope("download")))).json();
    if (opened.scheme !== "rs") throw new Error("this file uses an older format the app cannot read yet");
    const k = opened.sssK ?? 3;
    const signature = core.signAuth(opened.nonce, opened.issuedAt, "");
    onStep?.("fetching");
    const got: Uint8Array[] = [];
    const errors: string[] = [];
    for (const t of [...opened.nodes, ...(opened.fallbackNodes ?? [])]) {
      if (got.length >= k) break;
      try {
        const node = topo.nodes.find((n) => n.index === t.nodeIndex);
        if (!node) throw new Error(`node${t.nodeIndex} is not in the topology`);
        got.push(await getShard(node, t, this.wallet, signature, opened.issuedAt));
      } catch (e) {
        errors.push(String((e as Error).message ?? e));
      }
    }
    if (got.length < k) throw new Error(`only ${got.length} of ${k} shards reachable. ${errors.join("; ")}`);
    onStep?.("opening");
    const plain = await core.open(got);
    return { name: opened.name, mime: opened.mime, plain };
  }
}

const RETRYABLE = [429, 502, 503, 504];

async function putShard(node: Node, token: string, shard: Uint8Array, hash: string): Promise<void> {
  httpsOnly(`node${node.index}`, node.url);
  const url = `${node.url.replace(/\/+$/, "")}/api/nodes/node${node.index}`;
  for (let attempt = 1; ; attempt++) {
    try {
      await send(`node${node.index}`, url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream", "x-shard-sha256": hash },
        // expo/fetch (the global fetch on Android/iOS) sends typed arrays as raw bytes.
        body: shard as unknown as BodyInit,
      });
      return;
    } catch (e) {
      const retry = !(e instanceof HttpError) || RETRYABLE.includes(e.status);
      if (!retry || attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt + Math.random() * 250));
    }
  }
}

async function getShard(node: Node, t: ShardToken, wallet: string, signature: string, issuedAt: string): Promise<Uint8Array> {
  httpsOnly(`node${node.index}`, node.url);
  const res = await send(`node${t.nodeIndex}`, `${node.url.replace(/\/+$/, "")}/api/nodes/node${t.nodeIndex}`, {
    headers: {
      authorization: `Bearer ${t.token}`,
      "x-untrace-wallet": wallet,
      "x-untrace-signature": signature,
      "x-untrace-issued-at": issuedAt,
    },
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (t.sha256 && core.sha256Hex(bytes) !== t.sha256)
    throw new Error(`node${t.nodeIndex} returned bytes that do not match the recorded hash`);
  return bytes;
}
