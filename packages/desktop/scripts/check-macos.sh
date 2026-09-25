#!/bin/bash
# Lints the macOS code from Linux for both Mac architectures, without a Mac:
#   ./scripts/check-macos.sh
# Nothing is linked, so the two build scripts that compile C get stand-in tools
# that write empty objects. Needs `rustup target add aarch64-apple-darwin x86_64-apple-darwin`.
set -euo pipefail
cd "$(dirname "$0")/.."

tools=$(mktemp -d)
cat >"$tools/cc" <<'EOF'
#!/bin/sh
out=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
[ -n "$out" ] && : >"$out"
exit 0
EOF
cat >"$tools/ar" <<'EOF'
#!/bin/sh
for a in "$@"; do case "$a" in *.a) printf '!<arch>\n' >"$a"; exit 0 ;; esac; done
exit 0
EOF
chmod +x "$tools/cc" "$tools/ar"

for target in aarch64-apple-darwin x86_64-apple-darwin; do
  var=${target//-/_}
  export "CC_$var=$tools/cc" "AR_$var=$tools/ar"
  cargo clippy --target "$target" --all-targets -- -D warnings
done
