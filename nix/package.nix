{
  lib,
  stdenv,
  bun,
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
      ../package.json
      ../packages
      ../tsconfig.json
    ];
  };

  nodeModules = stdenv.mkDerivation {
    pname = "${pname}-node-modules";
    inherit version src;

    nativeBuildInputs = [bun];

    dontConfigure = true;
    dontBuild = true;

    installPhase = ''
      runHook preInstall

      export TMPDIR=$PWD/.tmp
      export HOME=$TMPDIR/home
      export BUN_INSTALL=$TMPDIR/bun-install
      export BUN_INSTALL_CACHE_DIR=$TMPDIR/bun-cache
      export BUN_TMPDIR=$TMPDIR/bun-tmp
      mkdir -p $HOME $BUN_INSTALL $BUN_INSTALL_CACHE_DIR $BUN_TMPDIR
      bun install --frozen-lockfile --ignore-scripts
      mkdir -p $out/packages
      cp -R node_modules $out/node_modules
      for package in packages/*; do
        if [ -d "$package/node_modules" ]; then
          mkdir -p "$out/$package"
          cp -R "$package/node_modules" "$out/$package/node_modules"
        fi
      done

      runHook postInstall
    '';

    outputHashAlgo = "sha256";
    outputHashMode = "recursive";
    outputHash = "sha256-y58LvD12BC90ZvP5KL+U8STLEdjxOmit42IUJYH7Z14=";
  };
in
  stdenv.mkDerivation {
    inherit pname version src;

    nativeBuildInputs = [
      bun
      makeWrapper
      nodejs
    ];

    ELECTRON_BINARY = "${electron}/bin/electron";
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

    configurePhase = ''
      runHook preConfigure

      export TMPDIR=$PWD/.tmp
      export HOME=$TMPDIR/home
      export BUN_INSTALL=$TMPDIR/bun-install
      export BUN_TMPDIR=$TMPDIR/bun-tmp
      mkdir -p $HOME $BUN_INSTALL $BUN_TMPDIR
      cp -R ${nodeModules}/node_modules node_modules
      for packageModules in ${nodeModules}/packages/*/node_modules; do
        package="packages/$(basename "$(dirname "$packageModules")")"
        mkdir -p "$package"
        cp -R "$packageModules" "$package/node_modules"
      done
      chmod -R u+w node_modules packages/*/node_modules
      patchShebangs node_modules packages/*/node_modules

      runHook postConfigure
    '';

    buildPhase = ''
      runHook preBuild

      bun run --filter @sorato/web build
      bun run --filter @sorato/desktop build
      bun build packages/server/src/main.ts --target bun --outdir server-dist --entry-naming main.js
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p \
        $out/bin \
        $out/share/sorato/server \
        $out/share/sorato/packages/desktop \
        $out/share/sorato/packages/web

      cp -r server-dist/. $out/share/sorato/server/

      makeWrapper ${bun}/bin/bun $out/bin/sorato-server \
        --add-flags "$out/share/sorato/server/main.js"

      cp packages/desktop/package.json $out/share/sorato/packages/desktop/package.json
      cp -r packages/desktop/dist-electron $out/share/sorato/packages/desktop/dist-electron
      cp -r packages/web/build $out/share/sorato/packages/web/build

      makeWrapper ${electron}/bin/electron $out/bin/sorato \
        --add-flags "$out/share/sorato/packages/desktop" \
        --set ELECTRON_SKIP_BINARY_DOWNLOAD 1 \
        --set ELECTRON_BINARY ${electron}/bin/electron \
        --set SORATO_SERVER_BIN $out/bin/sorato-server

      runHook postInstall
    '';

    meta = {
      description = "Tree-structured coding agent with a local desktop UI";
      mainProgram = "sorato";
      platforms = lib.platforms.linux ++ lib.platforms.darwin;
    };
  }
