import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REVISION_PATTERN = /^[0-9a-f]{40}$/;

export function validateSourceRevision(value) {
  if (!REVISION_PATTERN.test(value)) {
    throw new Error('--source-revision must be an exact lowercase 40-character Git commit SHA.');
  }
  return value;
}

export function validateExamplesManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('examples.json must contain an object.');
  }
  if (value.format !== 'noveltea.examples' || value.formatVersion !== 1) {
    throw new Error('examples.json must use noveltea.examples format version 1.');
  }
  if (typeof value.repository !== 'string' || value.repository.length === 0) {
    throw new Error('examples.json repository is required.');
  }
  if (!Array.isArray(value.examples) || value.examples.length === 0) {
    throw new Error('examples.json must declare at least one example.');
  }

  const ids = new Set();
  for (const example of value.examples) {
    if (!example || typeof example !== 'object' || Array.isArray(example)) {
      throw new Error('Each examples.json entry must be an object.');
    }
    if (typeof example.id !== 'string' || !ID_PATTERN.test(example.id)) {
      throw new Error(`Invalid example id '${String(example.id)}'.`);
    }
    if (ids.has(example.id)) throw new Error(`Duplicate example id '${example.id}'.`);
    ids.add(example.id);
    if (!Number.isSafeInteger(example.order)) {
      throw new Error(`Example '${example.id}' must have an integer order.`);
    }
    for (const field of ['title', 'description', 'sourcePath']) {
      if (typeof example[field] !== 'string' || example[field].length === 0) {
        throw new Error(`Example '${example.id}' must have a non-empty ${field}.`);
      }
    }
    if (!/^projects\/[a-z0-9-]+$/.test(example.sourcePath)) {
      throw new Error(`Example '${example.id}' sourcePath must name one projects/<id> directory.`);
    }
    if (!Array.isArray(example.highlights) || example.highlights.some((item) => typeof item !== 'string')) {
      throw new Error(`Example '${example.id}' highlights must be an array of strings.`);
    }
  }

  return {
    format: value.format,
    formatVersion: value.formatVersion,
    repository: value.repository,
    examples: [...value.examples].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
  };
}

export function validatePlayerDescriptor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Player descriptor must contain an object.');
  }
  if (value.format !== 'noveltea.player-template' || value.formatVersion !== 1) {
    throw new Error('Player descriptor must use noveltea.player-template format version 1.');
  }
  for (const field of ['templateId', 'buildId', 'engineVersion', 'platform', 'architecture']) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      throw new Error(`Player descriptor is missing ${field}.`);
    }
  }
  if (value.platform !== 'web' || value.architecture !== 'wasm32') {
    throw new Error('Examples require a Web wasm32 player template.');
  }
  if (!Array.isArray(value.compiledFeatures) || !value.compiledFeatures.includes('web-threads')) {
    throw new Error('Examples require the canonical threaded Web player template.');
  }
  if (!Number.isSafeInteger(value.compiledProjectFormatVersion) || !Number.isSafeInteger(value.playerRuntimeApiVersion)) {
    throw new Error('Player descriptor compatibility versions are required.');
  }
  return value;
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function artifactMetadata(path, relativePath) {
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error(`Expected file artifact at ${path}.`);
  return {
    path: relativePath.replaceAll('\\', '/'),
    size: stat.size,
    sha256: sha256File(path),
  };
}

export function directoryMetadata(root, catalogPrefix) {
  const files = [];
  const visit = (directory, relativeDirectory = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) files.push(artifactMetadata(absolute, `${catalogPrefix}/${relative}`));
      else throw new Error(`Playable output contains unsupported filesystem entry '${relative}'.`);
    }
  };
  visit(root);
  return files;
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
