package network.untrace.core

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Thin bridge to the compiled Untrace core (libuntrace_core.so, JNI exports
// Java_network_untrace_core_CoreJni_*). No crypto here: every key, signature,
// split and join happens inside the binary. The 32-byte account seed stays in
// native memory; JS never sees it.

object CoreJni {
  init { System.loadLibrary("untrace_core") }

  @JvmStatic external fun version(): String
  @JvmStatic external fun prfInput(index: Int): ByteArray
  @JvmStatic external fun seedFromPrf(prf: ByteArray): ByteArray
  @JvmStatic external fun wallet(seed: ByteArray): String
  @JvmStatic external fun signAuth(
    seed: ByteArray, nonce: String, issuedAt: String, op: String, resource: String, serverMessage: String
  ): String
  @JvmStatic external fun sealAccount(plain: ByteArray, seed: ByteArray, k: Int, n: Int): ByteArray
  @JvmStatic external fun openAccount(framed: ByteArray, seed: ByteArray): ByteArray
  @JvmStatic external fun sha256Hex(data: ByteArray): String
  @JvmStatic external fun uuidV4(): String
}

class CoreException(msg: String) : CodedException("ERR_UNTRACE_CORE", msg, null)

class UntraceCoreModule : Module() {
  private var seed: ByteArray? = null

  private fun requireSeed(): ByteArray = seed ?: throw CoreException("not signed in")

  private inline fun <T> core(block: () -> T): T =
    try { block() } catch (e: IllegalStateException) { throw CoreException(e.message ?: "core error") }

  override fun definition() = ModuleDefinition {
    Name("UntraceCore")

    Function("version") { CoreJni.version() }

    Function("prfInput") { index: Int -> core { CoreJni.prfInput(index) } }

    // PRF output -> seed (kept here) -> wallet address returned to JS.
    Function("signIn") { prf: ByteArray ->
      core {
        val s = CoreJni.seedFromPrf(prf)
        val w = CoreJni.wallet(s)
        seed?.fill(0)
        seed = s
        w
      }
    }

    Function("signOut") {
      seed?.fill(0)
      seed = null
    }

    Function("signAuth") { nonce: String, issuedAt: String, op: String, resource: String, message: String ->
      core { CoreJni.signAuth(requireSeed(), nonce, issuedAt, op, resource, message) }
    }

    AsyncFunction("seal") { plain: ByteArray, k: Int, n: Int ->
      core { CoreJni.sealAccount(plain, requireSeed(), k, n) }
    }

    AsyncFunction("open") { framed: ByteArray ->
      core { CoreJni.openAccount(framed, requireSeed()) }
    }

    Function("sha256Hex") { data: ByteArray -> core { CoreJni.sha256Hex(data) } }

    Function("uuidV4") { core { CoreJni.uuidV4() } }
  }
}
