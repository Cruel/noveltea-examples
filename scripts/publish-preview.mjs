#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import {
  assetOrigin,
  previewModeToken,
  previewPrefix,
  sha256,
  validatePreviewBuildMetadata,
  validateQualifiedPreviewCatalog,
  validateSnapshotManifest,
  verifyFile,
} from './preview-contract.mjs';

const bucket = 'noveltea-artifacts';
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const token = process.env.CLOUDFLARE_API_TOKEN ?? '';
const apiOrigin = process.env.CLOUDFLARE_API_ORIGIN || 'https://api.cloudflare.com';
const publicOrigin = (process.env.NOVELTEA_ASSET_ORIGIN || assetOrigin).replace(/\/+$/, '');
const previewOrigin = 'https://noveltea.pages.dev';

function store() {
  if (!/^[0-9a-f]{32}$/.test(accountId) || !token) throw new Error('Missing Cloudflare preview publication credentials.');
  const root = `${apiOrigin}/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects`;
  const objectUrl = (key) => `${root}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const request = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(120_000),
      redirect: 'error',
    });
    if (response.status === 404 && (options.method ?? 'GET') === 'GET') return null;
    if (!response.ok) throw new Error(`R2 ${options.method ?? 'GET'} failed (${response.status}).`);
    return response;
  };
  return {
    async get(key) {
      const response = await request(objectUrl(key), { method: 'GET' });
      return response ? Buffer.from(await response.arrayBuffer()) : null;
    },
    async put(key, bytes, contentType) {
      const existing = await this.get(key);
      if (existing && !existing.equals(bytes)) throw new Error(`Refusing to replace immutable preview object ${key}.`);
      if (!existing) {
        await request(objectUrl(key), {
          method: 'PUT',
          body: bytes,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=604800, immutable',
          },
        });
      }
      const stored = await this.get(key);
      if (!stored?.equals(bytes)) throw new Error(`Preview object verification failed: ${key}.`);
    },
    async delete(key) {
      await request(objectUrl(key), { method: 'DELETE' });
    },
    async list(prefix) {
      const values = [];
      let cursor;
      do {
        const query = new URLSearchParams({ prefix, per_page: '1000', ...(cursor ? { cursor } : {}) });
        const response = await request(`${root}?${query}`, { method: 'GET' });
        const body = await response.json();
        if (body.success !== true || !Array.isArray(body.result)) throw new Error('Invalid R2 listing response.');
        values.push(...body.result);
        cursor = body.result_info?.is_truncated ? body.result_info.cursor : undefined;
        if (body.result_info?.is_truncated && !cursor) throw new Error('Missing R2 listing cursor.');
      } while (cursor);
      return values;
    },
  };
}

function contentType(path) {
  const extension = extname(path).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
  }[extension] || 'application/octet-stream';
}

async function fetchSnapshot(metadata) {
  const response = await fetch(`${publicOrigin}/${metadata.snapshot.manifestKey}`, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Failed to resolve immutable nt snapshot (${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== metadata.snapshot.manifestSize || sha256(bytes) !== metadata.snapshot.manifestSha256) throw new Error('Immutable nt snapshot manifest digest mismatch.');
  return validateSnapshotManifest(JSON.parse(bytes), metadata.ntRevision);
}

function rebasedPlayableHtml(bytes) {
  return Buffer.from(bytes.toString('utf8').replaceAll('"/', '"./').replaceAll("'/", "'./"));
}

async function publish(root, prNumber, sourceRevision) {
  const metadata = validatePreviewBuildMetadata(JSON.parse(readFileSync(join(root, 'preview-build.json'))), { prNumber, sourceRevision });
  const catalogRecord = verifyFile(root, metadata.catalog);
  const catalog = JSON.parse(catalogRecord.bytes);
  const snapshot = await fetchSnapshot(metadata);
  validateQualifiedPreviewCatalog(catalog, metadata, snapshot);

  const prefix = previewPrefix(prNumber, sourceRevision);
  const previewPublicBase = `${previewOrigin}/examples/dev/preview-assets/${previewModeToken(prNumber, sourceRevision)}`;
  const storage = store();
  await storage.put(`${prefix}/catalog.json`, catalogRecord.bytes, 'application/json; charset=utf-8');
  const examples = [];
  for (const example of catalog.examples) {
    const runtimePackage = verifyFile(root, example.artifacts.runtimePackage);
    await storage.put(`${prefix}/${example.artifacts.runtimePackage.path}`, runtimePackage.bytes, 'application/octet-stream');
    const project = verifyFile(root, example.artifacts.projectBundle);
    await storage.put(`${prefix}/${example.artifacts.projectBundle.path}`, project.bytes, 'application/octet-stream');
    for (const fileMetadata of example.artifacts.playable.files) {
      const file = verifyFile(root, fileMetadata);
      const body = fileMetadata.path.endsWith('/index.html') ? rebasedPlayableHtml(file.bytes) : file.bytes;
      await storage.put(`${prefix}/${fileMetadata.path}`, body, contentType(fileMetadata.path));
    }
    examples.push({
      id: example.id,
      title: example.title,
      description: example.description,
      highlights: example.highlights,
      sourceUrl: `https://github.com/Cruel/noveltea-examples/tree/${sourceRevision}/${example.source.path}`,
      projectUrl: `${previewPublicBase}/${example.artifacts.projectBundle.path}`,
      projectSha256: example.artifacts.projectBundle.sha256,
      playerUrl: `${previewPublicBase}/${example.artifacts.playable.path}/index.html`,
    });
  }

  const preview = Buffer.from(`${JSON.stringify({
    format: 'noveltea.example-preview',
    formatVersion: 1,
    prNumber,
    source: { repository: 'https://github.com/Cruel/noveltea-examples', revision: sourceRevision },
    toolchain: { ntRevision: metadata.ntRevision, player: { buildId: catalog.toolchain.player.buildId, engineVersion: catalog.toolchain.player.engineVersion } },
    examples,
  }, null, 2)}\n`);
  await storage.put(`${prefix}/preview.json`, preview, 'application/json; charset=utf-8');
  writeFileSync(join(root, 'published-preview.json'), preview);
  process.stdout.write(`Published ${previewModeToken(prNumber, sourceRevision)} against nt ${metadata.ntRevision}.\n`);
}

async function cleanup(prefix) {
  const storage = store();
  const objects = await storage.list(prefix);
  for (const object of objects) await storage.delete(object.key);
  process.stdout.write(`Deleted ${objects.length} preview object(s) below ${prefix}.\n`);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'publish') {
  const [artifactRoot, pr, revision] = args;
  await publish(resolve(artifactRoot), Number.parseInt(pr, 10), revision);
} else if (command === 'cleanup-pr') {
  const pr = Number.parseInt(args[0], 10);
  if (!Number.isSafeInteger(pr) || pr < 1) throw new Error('cleanup-pr requires a PR number.');
  await cleanup(`development/example-previews/pr-${pr}/`);
} else if (command === 'cleanup-stale') {
  const active = new Set((args[0] || '').split(',').filter(Boolean).map((value) => Number.parseInt(value, 10)));
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const storage = store();
  const objects = await storage.list('development/example-previews/');
  const stale = new Set();
  for (const object of objects) {
    const match = /^development\/example-previews\/pr-([1-9][0-9]*)\//.exec(object.key);
    if (!match || active.has(Number.parseInt(match[1], 10))) continue;
    const modified = Date.parse(object.last_modified);
    if (Number.isFinite(modified) && modified < cutoff) stale.add(`development/example-previews/pr-${match[1]}/`);
  }
  for (const prefix of stale) await cleanup(prefix);
} else {
  throw new Error('Usage: publish-preview.mjs publish <artifact-root> <pr> <source-sha> | cleanup-pr <pr> | cleanup-stale <active-pr-csv>');
}
