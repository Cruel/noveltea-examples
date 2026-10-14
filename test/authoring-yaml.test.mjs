import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examples = ['materials', 'verbs'];

function structuredFiles(root) {
  const found = [];
  function visit(directory) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) found.push(absolute);
    }
  }
  visit(root);
  return found;
}

for (const example of examples) {
  test(`${example} is a YAML-only authored Project`, () => {
    const root = join(repositoryRoot, 'projects', example);
    for (const owner of [
      'project.yaml', 'editor.yaml', 'traits.yaml',
      'i18n/project.yaml', 'i18n/messages.yaml', 'i18n/tracking.yaml',
      'i18n/orphans.yaml', 'i18n/usage-notes.yaml',
      'records/scripts/bootstrap.yaml',
    ]) {
      assert.equal(existsSync(join(root, owner)), true, `${example}: missing ${owner}`);
    }
    for (const obsolete of ['project.json', 'editor.json', 'traits.json', 'localization.json']) {
      assert.equal(existsSync(join(root, obsolete)), false, `${example}: retired ${obsolete}`);
    }
    for (const directory of ['records', 'i18n']) {
      for (const file of structuredFiles(join(root, directory))) {
        assert.equal(file.endsWith('.json'), false, `${example}: retired authoring file ${file}`);
      }
    }
    assert.equal(
      structuredFiles(join(root, 'records')).some((file) => file.endsWith('.yaml')),
      true,
      `${example}: expected authored records`,
    );
  });
}
