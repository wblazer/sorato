{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    bun2nix = {
      # Includes offline manifest-cache support for sandboxed installs.
      url = "github:nix-community/bun2nix/3489482505adf9eafd4498c8e53015b5da980e13";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = {
    bun2nix,
    self,
    nixpkgs,
  }: let
    supportedSystems = ["x86_64-linux" "aarch64-linux" "aarch64-darwin"];
    forEachSupportedSystem = f:
      nixpkgs.lib.genAttrs supportedSystems (system:
        f {
          inherit system;
          pkgs = import nixpkgs {inherit system;};
        });
  in {
    packages = forEachSupportedSystem ({pkgs, ...}: let
      sorato = pkgs.callPackage ./nix/package.nix {
        bun2nix = bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default;
        electron = pkgs.electron_42;
      };
    in {
      default = sorato;
      sorato = sorato;
    });

    apps = forEachSupportedSystem ({system, ...}: {
      default = {
        type = "app";
        program = "${self.packages.${system}.default}/bin/sorato";
        meta.description = "Run Sorato";
      };
      sorato = self.apps.${system}.default;
    });

    devShells = forEachSupportedSystem ({pkgs, ...}: {
      default = pkgs.mkShell {
        BIOME_BINARY = "${pkgs.biome}/bin/biome";
        ELECTRON_BINARY = "${pkgs.electron}/bin/electron";
        ELECTRON_OVERRIDE_DIST_PATH = "${pkgs.electron}/bin";
        packages = with pkgs; [
          biome
          bun
          electron
          nodejs_22
          typescript
          typescript-language-server
          svelte-language-server
        ];
      };
    });
  };
}
