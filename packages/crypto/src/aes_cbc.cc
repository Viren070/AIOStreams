#include <napi.h>
#include <openssl/evp.h>

#include <climits>

namespace {

// aesCbcDecrypt(key, iv, data): raw AES-CBC, no padding, in place. Decrypting
// into the caller's buffer is the point: node:crypto's update() allocates a
// fresh Buffer per call.
Napi::Value AesCbcDecrypt(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsBuffer() || !info[1].IsBuffer() ||
      !info[2].IsBuffer()) {
    Napi::TypeError::New(env, "expected (key, iv, data) buffers")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  auto key = info[0].As<Napi::Buffer<unsigned char>>();
  auto iv = info[1].As<Napi::Buffer<unsigned char>>();
  auto data = info[2].As<Napi::Buffer<unsigned char>>();

  const EVP_CIPHER* cipher = key.Length() == 32   ? EVP_aes_256_cbc()
                             : key.Length() == 24 ? EVP_aes_192_cbc()
                             : key.Length() == 16 ? EVP_aes_128_cbc()
                                                  : nullptr;
  if (cipher == nullptr) {
    Napi::TypeError::New(env, "key must be 16, 24 or 32 bytes")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (iv.Length() != 16) {
    Napi::TypeError::New(env, "iv must be 16 bytes")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (data.Length() % 16 != 0 || data.Length() > INT_MAX) {
    Napi::TypeError::New(env, "data must be a multiple of 16 bytes")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  if (data.Length() == 0) return env.Undefined();

  EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
  if (ctx == nullptr) {
    Napi::Error::New(env, "EVP_CIPHER_CTX_new failed")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }
  int outl = 0;
  const bool ok =
      EVP_DecryptInit_ex(ctx, cipher, nullptr, key.Data(), iv.Data()) == 1 &&
      EVP_CIPHER_CTX_set_padding(ctx, 0) == 1 &&
      EVP_DecryptUpdate(ctx, data.Data(), &outl, data.Data(),
                        static_cast<int>(data.Length())) == 1;
  EVP_CIPHER_CTX_free(ctx);
  if (!ok || outl != static_cast<int>(data.Length())) {
    Napi::Error::New(env, "aes-cbc decrypt failed")
        .ThrowAsJavaScriptException();
  }
  return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("aesCbcDecrypt", Napi::Function::New(env, AesCbcDecrypt));
  return exports;
}

}  // namespace

NODE_API_MODULE(aios_crypto, Init)
