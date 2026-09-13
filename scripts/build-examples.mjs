#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  artifactMetadata,
  directoryMetadata,
  stableJson,
  validateExamplesManifest,
  validatePlayerDescriptor,
  validateSourceRevision,
} from './example-build-lib.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return `Usage: node scripts/build-examples.mjs \\
  --cli <noveltea> \\
  --player-template <template.zip> \\
  --player-descriptor <template.json> \\
  --source-revision <40-character-git-sha> \\
  [--output <directory>]

Every toolchain input is explicit. This script never resolves a floating NovelTea version.
`;
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') return { help: true };
    if (!['--cli', '--player-template', '--player-descriptor', '--source-revision', '--output'].includes(argument)) {
      throw new Error(`Unknown argument '${argument}'.\n\n${usage()}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for '${argument}'.\n\n${usage()}`);
    }
    if (values.has(argument)) throw new Error(`Argument '${argument}' may be provided only once.`);
    values.set(argument, value);
    index += 1;
  }
  for (const required of ['--cli', '--player-template', '--player-descriptor', '--source-revision']) {
    if (!values.has(required)) throw new Error(`Missing required argument '${required}'.\n\n${usage()}`);
  }
  return {
    help: false,
    cli: resolve(values.get('--cli')),
    playerTemplate: resolve(values.get('--player-template')),
    playerDescriptor: resolve(values.get('--player-descriptor')),
    sourceRevision: validateSourceRevision(values.get('--source-revision')),
    output: resolve(values.get('--output') ?? join(repositoryRoot, 'dist')),
  };
}

function assertRegularFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} must be an existing regular file: ${path}`);
  }
}

function runCli(cli, args, options = {}) {
  try {
    return execFileSync(cli, args, {
      cwd: repositoryRoot,
      env: options.env ?? process.env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const stdout = error?.stdout?.toString().trim();
    const stderr = error?.stderr?.toString().trim();
    const details = [stdout, stderr].filter(Boolean).join('\n');
    throw new Error(
      `NovelTea command failed: ${[cli, ...args].join(' ')}${details ? `\n${details}` : ''}`,
      { cause: error },
    );
  }
}

function runJsonCli(cli, args, options = {}) {
  const output = runCli(cli, ['--json', ...args], options);
  let envelope;
  try {
    envelope = JSON.parse(output);
  } catch (error) {
    throw new Error(`NovelTea command did not return valid JSON: ${output}`, { cause: error });
  }
  if (envelope?.success !== true) {
    throw new Error(`NovelTea command reported failure: ${stableJson(envelope).trimEnd()}`);
  }
  return envelope;
}

function copyProjectSource(source, destination) {
  cpSync(source, destination, {
    recursive: true,
    filter: (candidate) => {
      const name = basename(candidate);
      return name !== '.noveltea' && name !== 'dist' && name !== '.git';
    },
  });
}

function relativeCatalogPath(path, outputRoot) {
  const result = relative(outputRoot, path).replaceAll('\\', '/');
  if (!result || result.startsWith('../') || isAbsolute(result)) {
    throw new Error(`Generated artifact escaped output directory: ${path}`);
  }
  return result;
}

function buildExample({
  cli,
  environment,
  example,
  outputRoot,
  sourceRevision,
  templateToken,
  temporaryRoot,
}) {
  const sourceRoot = resolve(repositoryRoot, example.sourcePath);
  if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
    throw new Error(`Example '${example.id}' source directory is missing: ${sourceRoot}`);
  }

  const workingProject = join(temporaryRoot, 'projects', example.id);
  mkdirSync(dirname(workingProject), { recursive: true });
  copyProjectSource(sourceRoot, workingProject);

  runJsonCli(cli, ['--project', workingProject, 'validate'], { env: environment });

  const artifactDirectory = join(outputRoot, 'artifacts');
  mkdirSync(artifactDirectory, { recursive: true });
  const runtimePackage = join(artifactDirectory, `${example.id}.ntpkg`);
  const projectBundle = join(artifactDirectory, `${example.id}.ntproject`);

  runJsonCli(
    cli,
    [
      '--project',
      workingProject,
      'package',
      'export',
      '--output',
      runtimePackage,
      '--allow-localization-warnings',
    ],
    { env: environment },
  );
  runJsonCli(cli, ['--project', workingProject, 'project', 'export', '--output', projectBundle], {
    env: environment,
  });

  const importedProject = join(temporaryRoot, 'imports', example.id);
  mkdirSync(dirname(importedProject), { recursive: true });
  runJsonCli(cli, ['project', 'import', projectBundle, importedProject], { env: environment });
  runJsonCli(cli, ['--project', importedProject, 'validate'], { env: environment });

  const playableDirectory = join(outputRoot, 'playable', example.id);
  mkdirSync(dirname(playableDirectory), { recursive: true });
  runJsonCli(
    cli,
    [
      '--project',
      workingProject,
      'platform',
      'export',
      '--output',
      playableDirectory,
      '--profile',
      'web-threaded',
      '--template',
      templateToken,
      '--allow-untrusted-template',
      '--allow-localization-warnings',
    ],
    { env: environment },
  );

  const runtimeMetadata = artifactMetadata(
    runtimePackage,
    relativeCatalogPath(runtimePackage, outputRoot),
  );
  const projectMetadata = artifactMetadata(
    projectBundle,
    relativeCatalogPath(projectBundle, outputRoot),
  );
  const playablePath = relativeCatalogPath(playableDirectory, outputRoot);
  const playableFiles = directoryMetadata(playableDirectory, playablePath);
  if (playableFiles.length === 0) {
    throw new Error(`Example '${example.id}' produced an empty playable export.`);
  }

  return {
    id: example.id,
    order: example.order,
    title: example.title,
    description: example.description,
    highlights: example.highlights,
    source: {
      path: example.sourcePath,
      revision: sourceRevision,
    },
    artifacts: {
      runtimePackage: runtimeMetadata,
      projectBundle: projectMetadata,
      playable: {
        path: playablePath,
        files: playableFiles,
      },
    },
  };
}

function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.help) {
    process.stdout.write(usage());
    return;
  }

  assertRegularFile(arguments_.cli, 'NovelTea CLI');
  assertRegularFile(arguments_.playerTemplate, 'Player template archive');
  assertRegularFile(arguments_.playerDescriptor, 'Player template descriptor');

  const manifest = validateExamplesManifest(
    JSON.parse(readFileSync(join(repositoryRoot, 'examples.json'), 'utf8')),
  );
  const playerDescriptor = validatePlayerDescriptor(
    JSON.parse(readFileSync(arguments_.playerDescriptor, 'utf8')),
  );
  const templateToken = `${playerDescriptor.templateId}@${playerDescriptor.buildId}`;
  const cliVersion = runCli(arguments_.cli, ['--version']);
  const cliMetadata = artifactMetadata(arguments_.cli, 'toolchain/noveltea');
  const playerTemplateMetadata = artifactMetadata(
    arguments_.playerTemplate,
    'toolchain/player-template.zip',
  );
  const playerDescriptorMetadata = artifactMetadata(
    arguments_.playerDescriptor,
    'toolchain/player-template.json',
  );

  rmSync(arguments_.output, { recursive: true, force: true });
  mkdirSync(arguments_.output, { recursive: true });

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'noveltea-examples-'));
  try {
    const environment = {
      ...process.env,
      NOVELTEA_TEMPLATE_REGISTRY_ROOT: join(temporaryRoot, 'templates'),
      NOVELTEA_USER_CONFIG_ROOT: join(temporaryRoot, 'user-config'),
    };
    mkdirSync(environment.NOVELTEA_TEMPLATE_REGISTRY_ROOT, { recursive: true });
    mkdirSync(environment.NOVELTEA_USER_CONFIG_ROOT, { recursive: true });

    const installed = runJsonCli(
      arguments_.cli,
      ['platform', 'template', 'install', arguments_.playerTemplate, '--force'],
      { env: environment },
    );
    if (
      installed.entry?.templateId !== playerDescriptor.templateId ||
      installed.entry?.buildId !== playerDescriptor.buildId ||
      installed.entry?.archiveSha256 !== playerTemplateMetadata.sha256 ||
      installed.entry?.descriptorSha256 !== playerDescriptorMetadata.sha256
    ) {
      throw new Error(
        'Player template archive does not match the supplied verified player descriptor.',
      );
    }

    const examples = manifest.examples.map((example) =>
      buildExample({
        cli: arguments_.cli,
        environment,
        example,
        outputRoot: arguments_.output,
        sourceRevision: arguments_.sourceRevision,
        templateToken,
        temporaryRoot,
      }),
    );

    const catalog = {
      format: 'noveltea.example-catalog',
      formatVersion: 1,
      source: {
        repository: manifest.repository,
        revision: arguments_.sourceRevision,
      },
      toolchain: {
        cli: {
          version: cliVersion,
          ...cliMetadata,
        },
        player: {
          templateId: playerDescriptor.templateId,
          buildId: playerDescriptor.buildId,
          engineVersion: playerDescriptor.engineVersion,
          compiledProjectFormatVersion: playerDescriptor.compiledProjectFormatVersion,
          playerRuntimeApiVersion: playerDescriptor.playerRuntimeApiVersion,
          templateArchive: playerTemplateMetadata,
          descriptor: playerDescriptorMetadata,
        },
      },
      examples,
    };

    writeFileSync(join(arguments_.output, 'catalog.json'), stableJson(catalog), 'utf8');
    process.stdout.write(`Built ${examples.length} NovelTea examples into ${arguments_.output}.\n`);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
