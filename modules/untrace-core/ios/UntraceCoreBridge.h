/* Declarations of the compiled Untrace core C ABI (core.lock), so Swift in
 * this pod can call it. Declarations only, no logic. The library itself is
 * UntraceCoreFFI.xcframework, built at prebuild from the verified binary.
 * Return codes: 0 ok, -1 bad input, -2 seal/open failed, -3 refused to sign. */
#pragma once
#include <stddef.h>
#include <stdint.h>

typedef struct { uint8_t *ptr; size_t len; } UtBuf;

const char *untrace_core_version(void);
void untrace_free(UtBuf buf);
int32_t untrace_prf_input(uint32_t account_index, UtBuf *out);
int32_t untrace_seed_from_prf(const uint8_t *prf, size_t prf_len, uint8_t *seed_out32);
int32_t untrace_wallet(const uint8_t *seed32, UtBuf *out);
int32_t untrace_sign_auth(const uint8_t *seed32,
                          const uint8_t *nonce, size_t nonce_len,
                          const uint8_t *issued_at, size_t issued_at_len,
                          const uint8_t *op, size_t op_len,
                          const uint8_t *resource, size_t resource_len,
                          const uint8_t *server_message, size_t server_message_len,
                          UtBuf *out);
int32_t untrace_seal_account(const uint8_t *plain, size_t plain_len, const uint8_t *seed32, uint32_t k, uint32_t n, UtBuf *out);
int32_t untrace_open_account(const uint8_t *framed, size_t framed_len, const uint8_t *seed32, UtBuf *out);
int32_t untrace_sha256_hex(const uint8_t *data, size_t len, UtBuf *out);
int32_t untrace_uuid_v4(UtBuf *out);
