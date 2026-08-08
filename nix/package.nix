{
  lib,
  stdenv,
  autoPatchelfHook,
  bun,
  bun2nix,
  electron,
  makeWrapper,
  nodejs,
}: let
  pname = "sorato";
  version = "0.0.1";

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../bun.lock
      ../bun.nix
      ../package.json
      ../packages
      ../tsconfig.json
    ];
  };

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ../bun.nix;
  };
in
  stdenv.mkDerivation {
    inherit bunDeps pname src version;

    nativeBuildInputs = [
      bun
      bun2nix.hook
      makeWrapper
      nodejs
    ] ++ lib.optionals stdenv.hostPlatform.isLinux [autoPatchelfHook];

    buildInputs = lib.optionals stdenv.hostPlatform.isLinux [stdenv.cc.cc.lib];

    bunInstallFlags = [
      "--frozen-lockfile"
      "--linker=hoisted"
      "--backend=copyfile"
    ];

    dontRunLifecycleScripts = true;

    ELECTRON_BINARY = "${electron}/bin/electron";
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

    buildPhase = ''
      runHook preBuild

      bun run --filter @sorato/web build
      bun run --filter @sorato/desktop build
      bun build packages/cli/src/main.ts --target bun --outfile sorato-cli.js
      bun build packages/server/src/main.ts --target bun --outdir server-dist --entry-naming main.js --external @ff-labs/fff-node
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p \
        $out/bin \
        $out/share/sorato/server \
        $out/share/sorato/packages/desktop \
        $out/share/sorato/packages/web \
        $out/share/applications \
        $out/share/icons/hicolor/scalable/apps

      cp -r server-dist/. $out/share/sorato/server/

      makeWrapper ${bun}/bin/bun $out/bin/sorato-server \
        --add-flags "$out/share/sorato/server/main.js"

      cp sorato-cli.js $out/share/sorato/cli.js

      rm -rf node_modules packages/*/node_modules
      bun install \
        --frozen-lockfile \
        --production \
        --filter @sorato/server \
        --filter @sorato/desktop \
        --ignore-scripts \
        --linker=hoisted \
        --backend=copyfile \
        --offline
      rm -rf node_modules/@sorato
      ${lib.optionalString stdenv.hostPlatform.isGnu ''
        rm -rf node_modules/@ff-labs/fff-bin-linux-*-musl
        rm -rf node_modules/@yuuang/ffi-rs-linux-*-musl
        rm -f node_modules/@msgpackr-extract/msgpackr-extract-linux-*/*.musl.node
      ''}
      ${lib.optionalString stdenv.hostPlatform.isMusl ''
        rm -rf node_modules/@ff-labs/fff-bin-linux-*-gnu
        rm -rf node_modules/@yuuang/ffi-rs-linux-*-gnu
        rm -f node_modules/@msgpackr-extract/msgpackr-extract-linux-*/*.glibc.node
      ''}

      cp packages/desktop/package.json $out/share/sorato/packages/desktop/package.json
      cp -R node_modules $out/share/sorato/node_modules
      cp -r packages/desktop/dist-electron $out/share/sorato/packages/desktop/dist-electron
      cp -r packages/web/build $out/share/sorato/packages/web/build
      cp packages/web/src/lib/assets/favicon.svg $out/share/icons/hicolor/scalable/apps/sorato.svg

      makeWrapper ${electron}/bin/electron $out/bin/sorato-desktop \
        --add-flags "$out/share/sorato/packages/desktop" \
        --set ELECTRON_SKIP_BINARY_DOWNLOAD 1 \
        --set ELECTRON_BINARY ${electron}/bin/electron \
        --set SORATO_SERVER_BIN $out/bin/sorato-server

      makeWrapper ${bun}/bin/bun $out/bin/sorato \
        --add-flags "$out/share/sorato/cli.js" \
        --set SORATO_DESKTOP_BIN $out/bin/sorato-desktop \
        --set SORATO_SERVER_BIN $out/bin/sorato-server

      cat > $out/share/applications/sorato.desktop <<EOF
      [Desktop Entry]
      Type=Application
      Name=Sorato
      Comment=Tree-structured coding agent
      Exec=$out/bin/sorato desktop
      Icon=sorato
      Terminal=false
      Categories=Development;
      EOF

      runHook postInstall
    '';

    meta = {
      description = "Tree-structured coding agent with a local desktop UI";
      mainProgram = "sorato";
      platforms = lib.platforms.linux ++ lib.platforms.darwin;
    };
  }
