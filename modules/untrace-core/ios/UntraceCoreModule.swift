import ExpoModulesCore

// Thin bridge to the compiled Untrace core (UntraceCoreBridge.h). No crypto
// here: every key, signature, split and join happens inside the binary.
// The 32-byte account seed stays in native memory; JS never sees it.

private struct CoreError: Error, CustomStringConvertible {
  let description: String
}

private func reason(_ rc: Int32) -> String {
  switch rc {
  case -1: return "bad input"
  case -2: return "could not seal or open"
  case -3: return "refused to sign"
  default: return "core error \(rc)"
  }
}

private func take(_ buf: UtBuf) -> Data {
  defer { untrace_free(buf) }
  guard let p = buf.ptr, buf.len > 0 else { return Data() }
  return Data(bytes: p, count: Int(buf.len))
}

private func call(_ f: (UnsafeMutablePointer<UtBuf>) -> Int32) throws -> Data {
  var out = UtBuf(ptr: nil, len: 0)
  let rc = f(&out)
  if rc != 0 { throw CoreError(description: reason(rc)) }
  return take(out)
}

private func text(_ d: Data) -> String { String(decoding: d, as: UTF8.self) }

private extension Array where Element == UInt8 {
  mutating func resetBytes() { for i in indices { self[i] = 0 } }
}

public class UntraceCoreModule: Module {
  private var seed: [UInt8]? = nil

  private func requireSeed() throws -> [UInt8] {
    guard let s = seed else { throw CoreError(description: "not signed in") }
    return s
  }

  public func definition() -> ModuleDefinition {
    Name("UntraceCore")

    Function("version") { () -> String in
      String(cString: untrace_core_version())
    }

    Function("prfInput") { (index: Int) throws -> Data in
      try call { untrace_prf_input(UInt32(index), $0) }
    }

    // PRF output -> seed (kept here) -> wallet address returned to JS.
    Function("signIn") { (prf: Data) throws -> String in
      var s = [UInt8](repeating: 0, count: 32)
      let rc = prf.withUnsafeBytes { p in
        untrace_seed_from_prf(p.bindMemory(to: UInt8.self).baseAddress, prf.count, &s)
      }
      if rc != 0 { throw CoreError(description: reason(rc)) }
      let w: Data
      do { w = try call { untrace_wallet(s, $0) } } catch { s.resetBytes(); throw error }
      self.seed?.resetBytes()
      self.seed = s
      return text(w)
    }

    Function("signOut") { () in
      // Zero the stored buffer in place (a `var` copy would leave the original).
      self.seed?.resetBytes()
      self.seed = nil
    }

    Function("signAuth") { (nonce: String, issuedAt: String, op: String, resource: String, message: String) throws -> String in
      let s = try self.requireSeed()
      let n = Array(nonce.utf8), t = Array(issuedAt.utf8), o = Array(op.utf8)
      let r = Array(resource.utf8), m = Array(message.utf8)
      return text(try call { out in
        untrace_sign_auth(s, n, n.count, t, t.count, o, o.count, r, r.count, m, m.count, out)
      })
    }

    AsyncFunction("seal") { (plain: Data, k: Int, n: Int) throws -> Data in
      let s = try self.requireSeed()
      return try plain.withUnsafeBytes { p in
        try call { untrace_seal_account(p.bindMemory(to: UInt8.self).baseAddress, plain.count, s, UInt32(k), UInt32(n), $0) }
      }
    }

    AsyncFunction("open") { (framed: Data) throws -> Data in
      let s = try self.requireSeed()
      return try framed.withUnsafeBytes { p in
        try call { untrace_open_account(p.bindMemory(to: UInt8.self).baseAddress, framed.count, s, $0) }
      }
    }

    Function("sha256Hex") { (data: Data) throws -> String in
      text(try data.withUnsafeBytes { p in
        try call { untrace_sha256_hex(p.bindMemory(to: UInt8.self).baseAddress, data.count, $0) }
      })
    }

    Function("uuidV4") { () throws -> String in
      text(try call { untrace_uuid_v4($0) })
    }
  }
}
