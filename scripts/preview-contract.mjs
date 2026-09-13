import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
export const previewNamespace = 'development/example-previews';
export const assetOrigin = 'https://assets.noveltea.dev';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function validateArtifactMetadata(value, label = 'artifact') {
  if (!value || typeof value.path !== 'string' || !value.path || value.path.startsWith('/') || value.path.split('/').includes('..') || !Number.isSafeInteger(value.size) || value.size < 1 || !SHA256.test(value.sha256 ?? '')) {
    throw new Error(`Invalid ${label} metadata.`);
  }
  return value;
}

export function validateSnapshotPointer(value) {
  if (value?.format !== 'noveltea.development-toolchain-pointer' || !SHA40.test(value.revision ?? '') || !Number.isSafeInteger(value.runNumber) || value.runNumber < 1 || value.manifest?.key !== `development/toolchains/${value.revision}/snapshot.json` || !Number.isSafeInteger(value.manifest?.size) || value.manifest.size < 1 || !SHA256.test(value.manifest?.sha256 ?? '')) {
    throw new Error('Invalid NovelTea development snapshot pointer.');
  }
  return value;
}

export function validateSnapshotManifest(value, revision) {
  if (value?.format !== 'noveltea.development-toolchain' || value.revision !== revision || value.playerBuildId !== `dev-${revision}-web-wasm32-threads-release`) {
    throw new Error('Invalid NovelTea development snapshot manifest.');
  }
  for (const name of ['cli', 'player', 'descriptor']) {
    const item = value.artifacts?.[name];
    if (!item || typeof item.key !== 'string' || !item.key.startsWith(`development/toolchains/${revision}/`) || !Number.isSafeInteger(item.size) || item.size < 1 || !SHA256.test(item.sha256 ?? '')) throw new Error('Invalid NovelTea development snapshot artifact metadata.');
  }
  return value;
}

export function validatePreviewBuildMetadata(value, { prNumber, sourceRevision } = {}) {
  if (value?.format !== 'noveltea.example-preview-build' || value.formatVersion !== 1 || !Number.isSafeInteger(value.prNumber) || value.prNumber < 1 || !SHA40.test(value.sourceRevision ?? '') || !SHA40.test(value.ntRevision ?? '') || !value.snapshot || value.snapshot.manifestKey !== `development/toolchains/${value.ntRevision}/snapshot.json` || !SHA256.test(value.snapshot.manifestSha256 ?? '') || !Number.isSafeInteger(value.snapshot.manifestSize) || value.snapshot.manifestSize < 1 || !value.catalog) {
    throw new Error('Invalid NovelTea example preview build metadata.');
  }
  validateArtifactMetadata(value.catalog, 'preview catalog');
  if (prNumber !== undefined && value.prNumber !== prNumber) throw new Error('Preview PR identity mismatch.');
  if (sourceRevision !== undefined && value.sourceRevision !== sourceRevision) throw new Error('Preview source revision mismatch.');
  return value;
}

export function validateQualifiedPreviewCatalog(catalog, metadata, snapshot) {
  if (catalog?.format !== 'noveltea.example-catalog' || catalog.formatVersion !== 1 || catalog.source?.repository !== 'https://github.com/Cruel/noveltea-examples' || catalog.source?.revision !== metadata.sourceRevision || catalog.toolchain?.player?.engineVersion !== `dev-${metadata.ntRevision}` || catalog.toolchain?.player?.buildId !== `dev-${metadata.ntRevision}-web-wasm32-threads-release` || catalog.toolchain?.cli?.sha256 !== snapshot.artifacts.cli.sha256 || catalog.toolchain?.player?.templateArchive?.sha256 !== snapshot.artifacts.player.sha256 || catalog.toolchain?.player?.descriptor?.sha256 !== snapshot.artifacts.descriptor.sha256 || !Array.isArray(catalog.examples) || catalog.examples.length === 0) {
    throw new Error('Preview catalog does not match its source revision and immutable NovelTea snapshot.');
  }
  for (const example of catalog.examples) {
    validateArtifactMetadata(example?.artifacts?.runtimePackage, 'runtime package');
    validateArtifactMetadata(example?.artifacts?.projectBundle, 'project bundle');
    if (example?.source?.revision !== metadata.sourceRevision || !Array.isArray(example?.artifacts?.playable?.files) || example.artifacts.playable.files.length === 0) throw new Error('Preview catalog contains an incomplete example.');
    for (const item of example.artifacts.playable.files) validateArtifactMetadata(item, 'playable file');
  }
  return catalog;
}

export function verifyFile(root, metadata) {
  const path = resolve(root, metadata.path);
  const rel = relative(root, path);
  if (!rel || rel.startsWith('../') || rel === '..') throw new Error(`Preview artifact escaped root: ${metadata.path}`);
  const bytes = readFileSync(path);
  if (!statSync(path).isFile() || bytes.length !== metadata.size || sha256(bytes) !== metadata.sha256) throw new Error(`Preview artifact failed verification: ${metadata.path}`);
  return { path, bytes };
}

export function previewPrefix(prNumber, sourceRevision) {
  if (!Number.isSafeInteger(prNumber) || prNumber < 1 || !SHA40.test(sourceRevision)) throw new Error('Invalid preview namespace identity.');
  return `${previewNamespace}/pr-${prNumber}/${sourceRevision}`;
}

export function previewModeToken(prNumber, sourceRevision) {
  return `pr-${prNumber}/${sourceRevision}`;
}

export function parsePreviewModeToken(value) {
  const match = /^pr-([1-9][0-9]*)\/([0-9a-f]{40})$/.exec(value ?? '');
  if (!match) return null;
  return { prNumber: Number.parseInt(match[1], 10), sourceRevision: match[2] };
}
