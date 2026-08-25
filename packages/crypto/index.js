// The binary may be missing when the build was skipped; callers fall back to
// node:crypto.
'use strict';
let native = null;
try {
  native = require('./build/Release/aios_crypto.node');
} catch {
  try {
    native = require('./build/Debug/aios_crypto.node');
  } catch {
    native = null;
  }
}

module.exports = {
  aesCbcDecrypt: native ? native.aesCbcDecrypt : null,
};
