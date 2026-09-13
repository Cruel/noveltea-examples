# NovelTea Examples

Public, editable example Projects for NovelTea.

This repository owns example source and human-authored showcase metadata. It does not depend on the `Cruel/nt` source tree. Builds consume an explicit NovelTea standalone CLI plus an explicit Web player template/descriptor and produce a deterministic catalog and artifacts.

## Examples

- **Materials** demonstrates one authored shader, two material instances with different uniform overrides, and room presentation using those materials.
- **Verbs** demonstrates an Interactable Instance, a clickable hotspot, a one-slot Verb and Offer, Interaction resolution, and an ordered Command Builder program.

The showcase metadata source is [`examples.json`](./examples.json). Each entry names its Project Workspace under `projects/`; metadata is intentionally human-authored rather than inferred from Project files.

## Build contract

Requirements:

- Node.js 24 or newer.
- A standalone `noveltea` CLI executable.
- The exact canonical threaded Web player template ZIP to pair with that CLI.
- The matching `noveltea.player-template` descriptor JSON.
- The exact 40-character Git revision of this examples checkout.

Run:

```sh
node scripts/build-examples.mjs \
  --cli /path/to/noveltea \
  --player-template /path/to/player-web-wasm32-threads-release.zip \
  --player-descriptor /path/to/player-template.json \
  --source-revision "$(git rev-parse HEAD)" \
  --output dist
```

There is deliberately no implicit "latest" resolution. `nt` CI and examples-repository CI must resolve and verify their desired toolchain first, then invoke this same command with those exact files. This keeps the build seam identical while allowing each repository to own its separate toolchain-resolution policy.

The build uses isolated temporary NovelTea user/template roots, installs only the supplied player template, validates each Project, exports and round-trips its `.ntproject`, emits its `.ntpkg`, and performs a Web platform export with the exact supplied player. Existing output is replaced as one generated build directory.

The generated `catalog.json` uses `noveltea.example-catalog` format version 1 and records:

- exact examples repository/revision provenance;
- CLI version, size, and SHA-256;
- exact player template/build/engine identity and compatibility versions;
- size and SHA-256 for each `.ntpkg` and `.ntproject`;
- every file in each playable Web export, with size and SHA-256;
- the source path and human-authored metadata for each example.

For identical source and toolchain inputs, the generated catalog is byte-identical. Runtime packages also use deterministic ZIP metadata in the required NovelTea toolchain, so their digests and hashed playable package names remain stable.

## Verification

Run the repository-local contract tests:

```sh
npm test
```

For the complete integration seam, run the build command above. A successful build proves both Projects validate, `.ntproject` export/import round-trips and revalidates, runtime packages export, and the supplied Web player can stage playable artifacts.
