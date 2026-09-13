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
- one shared Web player file set (`player/*.wasm`, `player/*.js`, and `player/*.data`) verified to be byte-identical across every exported example;
- size and SHA-256 for each `.ntpkg` and `.ntproject`;
- each example's small launcher/config/runtime-package files, with size and SHA-256;
- the source path and human-authored metadata for each example.

The normal NovelTea Web exporter remains self-contained. This repository's aggregate build validates each example through that exporter, then factors the identical player runtime out once and rewrites each launcher to reference `../../player/`. The aggregate artifact therefore carries one exact compatible player plus independent example `.ntpkg` payloads instead of duplicating the player for every Project.

For identical source and toolchain inputs, the generated catalog is byte-identical. Runtime packages also use deterministic ZIP metadata in the required NovelTea toolchain, so their digests and hashed playable package names remain stable.

## Pull-request previews

Pull requests build against one immutable NovelTea development snapshot resolved from `https://assets.noveltea.dev/development/toolchains/current.json`. `preview-build.yml` has read-only repository permissions, receives no Cloudflare or private-`nt` credential, verifies every snapshot object by size and SHA-256, then uploads the generated preview only as a short-lived GitHub Actions artifact.

Publication is deliberately separate. `preview-publish.yml` runs only after the unprivileged build succeeds, checks out trusted `main` publication code, downloads the untrusted artifact without executing anything from it, independently re-fetches the immutable NovelTea snapshot manifest, validates the PR/source identity, toolchain hashes, player identity, and every catalogued file, and only then receives the examples-specific R2 token. Valid previews are stored below `development/example-previews/pr-<number>/<examples-revision>/` in `noveltea-artifacts`; the immutable preview URL is `https://noveltea.dev/examples/dev/?preview=pr-<number>/<examples-revision>`.

The production Pages deployment contains a stable, narrowly scoped preview proxy on the separate `https://noveltea.pages.dev` origin. Preview metadata points player/project URLs at `/examples/dev/preview-assets/<token>/...` on that origin; the proxy maps only those exact immutable paths to R2 and adds the COOP/COEP/CORP response headers required by the threaded Web player. This avoids relying on unsupported arbitrary R2 object-response metadata and keeps preview player content off the primary `noveltea.dev` origin.

The published `preview.json` records both the exact examples revision and exact `nt` revision. The one shared Web player plus every example launcher/`.ntpkg` is copied into that same immutable namespace, so a later `nt/master` snapshot cannot change or break an existing preview and the player is not duplicated per example. Closing or merging a PR immediately deletes the entire PR namespace through trusted `pull_request_target` cleanup. A daily cleanup deletes previews older than 14 days only for PRs that are no longer open.

The preview publisher uses only `CLOUDFLARE_API_TOKEN` (the repository's examples-specific R2-only token) and `CLOUDFLARE_ACCOUNT_ID`. This repository must not receive an `nt` Pages-capable Cloudflare token, `NOVELTEA_RELEASES_TOKEN`, or a GitHub credential capable of accessing private `Cruel/nt` content.

## Verification

Run the repository-local contract tests:

```sh
npm test
```

For the complete integration seam, run the build command above. A successful build proves both Projects validate, `.ntproject` export/import round-trips and revalidates, runtime packages export, and the supplied Web player can stage playable artifacts.
