import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parsePreviewModeToken,
  previewModeToken,
  previewPrefix,
  validatePreviewBuildMetadata,
  validateQualifiedPreviewCatalog,
  validateSnapshotManifest,
  validateSnapshotPointer,
} from '../scripts/preview-contract.mjs';

const ntRevision = 'a'.repeat(40);
const sourceRevision = 'b'.repeat(40);
const digest = (character) => character.repeat(64);

function snapshotManifest() {
  return {
    format: 'noveltea.development-toolchain',
    revision: ntRevision,
    playerBuildId: `dev-${ntRevision}-web-wasm32-threads-release`,
    artifacts: {
      cli: { key: `development/toolchains/${ntRevision}/noveltea-linux-x64`, size: 1, sha256: digest('1') },
      player: { key: `development/toolchains/${ntRevision}/player-web-wasm32-threads-release.zip`, size: 1, sha256: digest('2') },
      descriptor: { key: `development/toolchains/${ntRevision}/template.json`, size: 1, sha256: digest('3') },
    },
  };
}

function previewMetadata() {
  return {
    format: 'noveltea.example-preview-build',
    formatVersion: 1,
    prNumber: 42,
    sourceRevision,
    ntRevision,
    snapshot: {
      manifestKey: `development/toolchains/${ntRevision}/snapshot.json`,
      manifestSize: 123,
      manifestSha256: digest('4'),
    },
    catalog: { path: 'catalog.json', size: 50, sha256: digest('5') },
  };
}

function catalog() {
  return {
    format: 'noveltea.example-catalog',
    formatVersion: 1,
    source: { repository: 'https://github.com/Cruel/noveltea-examples', revision: sourceRevision },
    toolchain: {
      cli: { sha256: digest('1') },
      player: {
        engineVersion: `dev-${ntRevision}`,
        buildId: `dev-${ntRevision}-web-wasm32-threads-release`,
        templateArchive: { sha256: digest('2') },
        descriptor: { sha256: digest('3') },
        files: [
          { path: 'player/player.aaa.wasm', size: 10, sha256: digest('a') },
          { path: 'player/player.aaa.js', size: 11, sha256: digest('b') },
          { path: 'player/player.aaa.data', size: 12, sha256: digest('c') },
        ],
      },
    },
    examples: [
      {
        id: 'materials',
        source: { revision: sourceRevision },
        artifacts: {
          runtimePackage: { path: 'artifacts/materials.ntpkg', size: 1, sha256: digest('8') },
          projectBundle: { path: 'artifacts/materials.ntproject', size: 1, sha256: digest('6') },
          playable: {
            path: 'playable/materials',
            files: [{ path: 'playable/materials/index.html', size: 1, sha256: digest('7') }],
          },
        },
      },
    ],
  };
}

test('preview mode is an explicit immutable PR/revision token', () => {
  assert.equal(previewPrefix(42, sourceRevision), `development/example-previews/pr-42/${sourceRevision}`);
  assert.equal(previewModeToken(42, sourceRevision), `pr-42/${sourceRevision}`);
  assert.deepEqual(parsePreviewModeToken(`pr-42/${sourceRevision}`), { prNumber: 42, sourceRevision });
  assert.equal(parsePreviewModeToken('pr-42/main'), null);
});

test('snapshot pointer pins one immutable development snapshot', () => {
  const pointer = {
    format: 'noveltea.development-toolchain-pointer',
    revision: ntRevision,
    runNumber: 99,
    manifest: { key: `development/toolchains/${ntRevision}/snapshot.json`, size: 123, sha256: digest('4') },
  };
  assert.equal(validateSnapshotPointer(pointer), pointer);
  assert.equal(validateSnapshotManifest(snapshotManifest(), ntRevision).revision, ntRevision);
});

test('trusted publication rejects preview identity and toolchain substitution', () => {
  const metadata = previewMetadata();
  assert.equal(validatePreviewBuildMetadata(metadata, { prNumber: 42, sourceRevision }), metadata);
  assert.equal(validateQualifiedPreviewCatalog(catalog(), metadata, snapshotManifest()).source.revision, sourceRevision);

  const wrongSource = previewMetadata();
  wrongSource.sourceRevision = 'c'.repeat(40);
  assert.throws(() => validatePreviewBuildMetadata(wrongSource, { prNumber: 42, sourceRevision }), /source revision mismatch/i);

  const wrongPlayer = catalog();
  wrongPlayer.toolchain.player.engineVersion = `dev-${'c'.repeat(40)}`;
  assert.throws(() => validateQualifiedPreviewCatalog(wrongPlayer, metadata, snapshotManifest()), /immutable NovelTea snapshot/);

  const duplicatedPlayer = catalog();
  duplicatedPlayer.toolchain.player.files = [];
  assert.throws(
    () => validateQualifiedPreviewCatalog(duplicatedPlayer, metadata, snapshotManifest()),
    /immutable NovelTea snapshot/,
  );
});
