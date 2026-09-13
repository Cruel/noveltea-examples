import test from 'node:test';
import assert from 'node:assert/strict';

import {
  stableJson,
  validateExamplesManifest,
  validatePlayerDescriptor,
  validateSourceRevision,
} from '../scripts/example-build-lib.mjs';

test('examples manifest normalizes deterministic example order', () => {
  const manifest = validateExamplesManifest({
    format: 'noveltea.examples',
    formatVersion: 1,
    repository: 'Cruel/noveltea-examples',
    examples: [
      {
        id: 'verbs',
        order: 20,
        title: 'Verbs',
        description: 'Verb example',
        sourcePath: 'projects/verbs',
        highlights: ['Interactions'],
      },
      {
        id: 'materials',
        order: 10,
        title: 'Materials',
        description: 'Material example',
        sourcePath: 'projects/materials',
        highlights: ['Materials'],
      },
    ],
  });

  assert.deepEqual(
    manifest.examples.map((example) => example.id),
    ['materials', 'verbs'],
  );
  assert.equal(stableJson(manifest).endsWith('\n'), true);
});

test('examples manifest rejects duplicate IDs', () => {
  assert.throws(
    () =>
      validateExamplesManifest({
        format: 'noveltea.examples',
        formatVersion: 1,
        repository: 'Cruel/noveltea-examples',
        examples: [
          {
            id: 'materials',
            order: 10,
            title: 'Materials',
            description: 'One',
            sourcePath: 'projects/materials',
            highlights: [],
          },
          {
            id: 'materials',
            order: 20,
            title: 'Materials again',
            description: 'Two',
            sourcePath: 'projects/materials',
            highlights: [],
          },
        ],
      }),
    /Duplicate example id 'materials'/,
  );
});

test('source revision must be an exact commit SHA', () => {
  assert.equal(validateSourceRevision('a'.repeat(40)), 'a'.repeat(40));
  assert.throws(() => validateSourceRevision('main'), /exact lowercase 40-character Git commit SHA/);
});

test('player descriptor requires the canonical threaded Web shape', () => {
  const descriptor = {
    format: 'noveltea.player-template',
    formatVersion: 1,
    templateId: 'web-wasm32-threads-release',
    buildId: 'dev-deadbeef-web-wasm32-threads-release',
    engineVersion: 'dev-deadbeef',
    platform: 'web',
    architecture: 'wasm32',
    compiledProjectFormatVersion: 1,
    playerRuntimeApiVersion: 1,
    compiledFeatures: ['lua', 'web-threads'],
  };
  assert.equal(validatePlayerDescriptor(descriptor), descriptor);
  assert.throws(
    () => validatePlayerDescriptor({ ...descriptor, compiledFeatures: ['lua'] }),
    /canonical threaded Web player template/,
  );
});
