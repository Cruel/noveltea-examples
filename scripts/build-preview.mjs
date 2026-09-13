#!/usr/bin/env node

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assetOrigin,
  sha256,
  validateSnapshotManifest,
  validateSnapshotPointer,
} from './preview-contract.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(process.env.NOVELTEA_PREVIEW_OUTPUT ?? join(repositoryRoot, 'dist-preview'));
const toolchainRoot = resolve(process.env.NOVELTEA_PREVIEW_TOOLCHAIN ?? join(repositoryRoot, '.preview-toolchain'));
const sourceRoot = resolve(process.env.NOVELTEA_PREVIEW_SOURCE_ROOT ?? repositoryRoot);
const prNumber = Number.parseInt(process.env.NOVELTEA_PREVIEW_PR ?? '', 10);
const sourceRevision = process.env.NOVELTEA_PREVIEW_SOURCE_REVISION ?? '';
const origin = (process.env.NOVELTEA_ASSET_ORIGIN || assetOrigin).replace(/\/+$/, '');

if (!Number.isSafeInteger(prNumber) || prNumber < 1 || !/^[0-9a-f]{40}$/.test(sourceRevision)) {
  throw new Error('NOVELTEA_PREVIEW_PR and NOVELTEA_PREVIEW_SOURCE_REVISION are required.');
}

async function fetchBytes(key, { noStore = false } = {}) {
  const response = await fetch(`${origin}/${key}`, {
    cache: noStore ? 'no-store' : 'default',
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Failed to fetch ${key}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function verify(bytes, metadata, label) {
  if (bytes.length !== metadata.size || sha256(bytes) !== metadata.sha256) {
    throw new Error(`${label} failed size/SHA-256 verification.`);
  }
}

const pointerBytes = await fetchBytes('development/toolchains/current.json', { noStore: true });
const pointer = validateSnapshotPointer(JSON.parse(pointerBytes));
const manifestBytes = await fetchBytes(pointer.manifest.key);
verify(manifestBytes, pointer.manifest, 'Development snapshot manifest');
const snapshot = validateSnapshotManifest(JSON.parse(manifestBytes), pointer.revision);

mkdirSync(toolchainRoot, { recursive: true });
const inputs = {};
for (const [name, fileName] of [
  ['cli', 'noveltea'],
  ['player', 'player.zip'],
  ['descriptor', 'template.json'],
]) {
  const metadata = snapshot.artifacts[name];
  const bytes = await fetchBytes(metadata.key);
  verify(bytes, metadata, `Development snapshot ${name}`);
  const path = join(toolchainRoot, fileName);
  writeFileSync(path, bytes);
  inputs[name] = path;
}
chmodSync(inputs.cli, 0o755);

execFileSync(
  process.execPath,
  [
    'scripts/build-examples.mjs',
    '--cli', inputs.cli,
    '--player-template', inputs.player,
    '--player-descriptor', inputs.descriptor,
    '--source-revision', sourceRevision,
    '--output', outputRoot,
  ],
  {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env: { ...process.env, NOVELTEA_EXAMPLES_SOURCE_ROOT: sourceRoot },
  },
);

const catalogBytes = readFileSync(join(outputRoot, 'catalog.json'));
writeFileSync(
  join(outputRoot, 'preview-build.json'),
  `${JSON.stringify(
    {
      format: 'noveltea.example-preview-build',
      formatVersion: 1,
      prNumber,
      sourceRevision,
      ntRevision: snapshot.revision,
      snapshot: {
        manifestKey: pointer.manifest.key,
        manifestSize: pointer.manifest.size,
        manifestSha256: pointer.manifest.sha256,
      },
      catalog: {
        path: 'catalog.json',
        size: catalogBytes.length,
        sha256: sha256(catalogBytes),
      },
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(`Built preview for PR #${prNumber} at examples ${sourceRevision} against nt ${snapshot.revision}.\n`);
