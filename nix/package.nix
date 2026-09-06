# Build package for the AIOStreams Node workspace (core + server + frontend).
# Produces:
#   $out/bin/aiostreams-server   - node wrapper that starts the API server
#   $out/lib/aiostreams/         - full working tree (dist outputs, node_modules)
{ pkgs, src }:

let
  inherit (pkgs) lib;
  # Pinned to 22, not 24: better-sqlite3 12.x, when compiled from source
  # (node-gyp) rather than from an upstream prebuilt, crashes at runtime on
  # Node 24 during GC finalization of a Statement:
  #   node::RemoveEnvironmentCleanupHook -> Assertion failed: (env) != nullptr
  # The offline build sandbox forces the from-source path (prebuild-install
  # can't reach the network), so the official node:24 Docker image is
  # unaffected but this package is. Node 22 builds a working binary.
  # Revert to nodejs_24 once better-sqlite3 is bumped past this fix.
  nodejs = pkgs.nodejs_22 or pkgs.nodejs;
  pnpm = pkgs.pnpm_11 or pkgs.pnpm; # packageManager: pnpm@11

  # fetcherVersion 4 dumps the pnpm store as a SQLite SQL file; pnpmConfigHook
  # (nativeBuildInputs, below) rehydrates it during configurePhase. Without
  # the hook, pnpm can't see any of these packages as "reused" and silently
  # falls back to the network for the entire dependency graph.
  pnpmDeps = pkgs.fetchPnpmDeps {
    inherit src pnpm;
    pname = "aiostreams";
    version = "2.32.1";
    fetcherVersion = 4;
    hash = "sha256-2yUusJ6nt6wX7Ax10Ekyc47T+B3Dcq2dfE5stj3ypBA=";
  };
in
pkgs.stdenv.mkDerivation {
  pname = "aiostreams";
  version = "2.32.1";
  inherit src pnpmDeps;

  nativeBuildInputs = [
    nodejs
    pnpm
    pkgs.pnpmConfigHook
    pkgs.python3 # node-gyp (better-sqlite3, yencode) compile
    pkgs.gcc13 # C toolchain for native modules
    # yencode bundles crcutil as a C dependency, bootstrapped via
    # autotools (configure/Makefile.am/autogen.sh) before node-gyp
    # links against it.
    pkgs.autoconf
    pkgs.automake
    pkgs.libtool
    pkgs.pkg-config
  ];

  NODE_OPTIONS = "--max-old-space-size=8192";

  buildPhase = ''
    runHook preBuild

    export HOME="$PWD"
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

    # node-gyp otherwise targets whatever Node is running it — and nixpkgs'
    # pnpm bundles its own Node, which is not necessarily ${nodejs}. That
    # mismatch ships a native module built for the wrong NODE_MODULE_VERSION
    # (seen with yencode: "compiled against ... 137 ... requires ... 127").
    # Pin every node-gyp build to ${nodejs}'s headers/ABI, and never let
    # prebuild-install substitute a mismatched prebuilt.
    export npm_config_nodedir="${nodejs}"
    export npm_config_build_from_source=true

    # pnpm self-reconciles against package.json's packageManager pin by
    # querying the npm registry for that exact release, which the offline
    # build sandbox can't reach. Drop the pin — nixpkgs' pnpm (already on
    # PATH via nativeBuildInputs) is close enough, and this only touches
    # the ephemeral build copy.
    sed -i '/"packageManager":/d' package.json

    # Re-run the install without --ignore-scripts to build the
    # onlyBuiltDependencies packages (see pnpm-workspace.yaml). --force
    # is required: a plain re-install treats the lockfile as already
    # satisfied and skips everything, since pnpmConfigHook already
    # materialized node_modules (just without scripts). This reliably
    # builds most of them (bcrypt, sharp, core-js, esbuild, sqlite3,
    # unrs-resolver — verified via their compiled binaries surviving
    # into $out).
    pnpm install --offline --frozen-lockfile --force

    # better-sqlite3 and yencode are the two onlyBuiltDependencies
    # entries whose build/ directory never gets created no matter how
    # `pnpm install --force`/`pnpm rebuild` is invoked or scoped —
    # confirmed by direct testing, not assumed. Both have real install
    # scripts (better-sqlite3: "prebuild-install || node-gyp rebuild",
    # yencode: "node-gyp rebuild", plus yencode is also a patched
    # dependency). Build each directly: find wherever pnpm placed it in
    # the content-addressed store and run its own install script by
    # hand. `pnpm --dir <path> run install` (not a bare `node-gyp
    # rebuild`) reuses pnpm's own PATH/env setup for locating
    # node-gyp — a bare `node-gyp` isn't on PATH outside that.
    # Rebuild every copy pnpm materialized (a patched dep like yencode also
    # shows up as `yencode@1.2.4(patch_hash=...)`), wiping any stale build/
    # left by the `pnpm install --force` above so node-gyp can't skip it.
    buildPnpmDep() {
      local name="$1" nodeFile="$2" found=0 pkgdir
      while IFS= read -r dir; do
        pkgdir="$dir/node_modules/$name"
        [ -d "$pkgdir" ] || continue
        rm -rf "$pkgdir/build" "$pkgdir/prebuilds"
        pnpm --dir "$pkgdir" run install
        test -f "$pkgdir/$nodeFile" && found=1
      done < <(find node_modules/.pnpm -maxdepth 1 -iname "''${name}@*")
      if [ "$found" -ne 1 ]; then
        echo "ERROR: $name not rebuilt under node_modules/.pnpm" >&2
        exit 1
      fi
    }
    buildPnpmDep better-sqlite3 build/Release/better_sqlite3.node
    buildPnpmDep yencode build/Release/yencode.node

    pnpm run metadata
    pnpm build

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin" "$out/lib/aiostreams"
    cp -a --no-preserve=mode . "$out/lib/aiostreams/"

    cat >"$out/bin/aiostreams-server" <<'EOF_SERVER'
    #!/nix/store/__NODE__/bin/node
    "use strict";
    require(__dirname + "/../lib/aiostreams/packages/server/dist/server.js");
    EOF_SERVER
    sed -i "s|/nix/store/__NODE__|${nodejs}|" "$out/bin/aiostreams-server"
    chmod +x "$out/bin/aiostreams-server"

    runHook postInstall
  '';

  meta = {
    description = "Stremio super-addon aggregating Stremio addons and debrid services";
    homepage = "https://aiostreams.github.io";
    license = lib.licenses.mit;
    mainProgram = "aiostreams-server";
  };
}
