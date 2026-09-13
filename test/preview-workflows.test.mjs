import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (name) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');

test('preview build runs trusted workflow code without publication credentials', () => {
  const workflow = read('preview-build.yml');
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /ref: main/);
  assert.match(workflow, /path: build\/proposed-examples/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /NOVELTEA_PREVIEW_SOURCE_ROOT:/);
  assert.doesNotMatch(workflow, /CLOUDFLARE_API_TOKEN|NOVELTEA_RELEASES_TOKEN/);
});

test('preview publication is a trusted workflow_run consumer that validates before secrets are used', () => {
  const workflow = read('preview-publish.yml');
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows: \[Example preview build\]/);
  assert.match(workflow, /Checkout trusted publication code[\s\S]*?ref: main/);
  assert.match(workflow, /Verify artifact targets the current PR head[\s\S]*?Validate and publish preview/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.doesNotMatch(workflow, /checkout.*pull_request\.head/);
});

test('preview cleanup deletes closed PR namespaces and has a stale failsafe', () => {
  const workflow = read('preview-cleanup.yml');
  assert.match(workflow, /pull_request_target:/);
  assert.match(workflow, /types: \[closed\]/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /cleanup-pr/);
  assert.match(workflow, /cleanup-stale/);
});
