{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
  };

  outputs = {
    self,
    nixpkgs,
  }: let
    supportedSystems = ["x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin"];
    forEachSupportedSystem = f:
      nixpkgs.lib.genAttrs supportedSystems (system:
        f {
          inherit system;
          pkgs = import nixpkgs {inherit system;};
        });
  in {
    packages = forEachSupportedSystem ({pkgs, ...}: let
      sorato = pkgs.callPackage ./nix/package.nix {};
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
          typescript
          typescript-language-server
          svelte-language-server
        ];
      };
    });
  };
}
