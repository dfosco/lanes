#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registry = 'https://registry.npmjs.org';
let packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const stableTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...options,
  }).trim();
}

function validateVersionTag(tag, version) {
  const match = stableTagPattern.exec(tag ?? '');
  if (!match) throw new Error(`Expected a stable vMAJOR.MINOR.PATCH tag; got ${JSON.stringify(tag)}.`);
  if (`${match[1]}.${match[2]}.${match[3]}` !== version) {
    throw new Error(`Tag ${tag} does not match package version ${version}.`);
  }
  return tag;
}

function currentTag() {
  const event = process.env.RELEASE_EVENT;
  const tag = event === 'workflow_dispatch'
    ? process.env.DISPATCH_TAG
    : process.env.RELEASE_TAG;
  if (event !== 'workflow_dispatch' && event !== 'push') {
    throw new Error(`Unsupported release event ${JSON.stringify(event)}.`);
  }
  if (!stableTagPattern.test(tag ?? '')) {
    throw new Error(`Expected a stable vMAJOR.MINOR.PATCH tag; got ${JSON.stringify(tag)}.`);
  }
  if (event === 'push' && process.env.GITHUB_REF !== `refs/tags/${tag}`) {
    throw new Error('Tag push ref does not match the selected release tag.');
  }
  return tag;
}

async function checkoutReleaseTag(tag) {
  const ref = `refs/tags/${tag}`;
  try {
    run('git', ['show-ref', '--verify', '--quiet', ref]);
  } catch {
    run('git', ['fetch', '--force', '--no-tags', 'origin', `${ref}:${ref}`]);
  }
  run('git', ['fetch', '--force', '--no-tags', 'origin', 'refs/heads/main:refs/remotes/origin/main']);
  const tagCommit = run('git', ['rev-parse', `${ref}^{commit}`]);
  run('git', ['checkout', '--detach', ref]);
  const head = run('git', ['rev-parse', 'HEAD']);
  if (head !== tagCommit) throw new Error(`Checked out ${head}, expected tag commit ${tagCommit}.`);
  try {
    run('git', ['merge-base', '--is-ancestor', tagCommit, 'refs/remotes/origin/main']);
  } catch {
    throw new Error(`Release tag ${tag} does not point to a commit on origin/main.`);
  }
  packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  validateVersionTag(tag, packageJson.version);
}

async function packedArtifact() {
  const output = run('npm', ['pack', '--json', '--ignore-scripts']);
  const [pack] = JSON.parse(output);
  if (!pack?.filename || !pack?.integrity) throw new Error('npm pack did not return a filename and integrity.');
  return { file: path.join(root, pack.filename), integrity: pack.integrity };
}

async function registryVersion(version, fetcher = fetch, packageName = packageJson.name) {
  const encodedName = encodeURIComponent(packageName).replaceAll('%2F', '%2f');
  const response = await fetcher(`${registry}/${encodedName}`, {
    headers: { accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm registry lookup failed: HTTP ${response.status}.`);
  const packument = await response.json();
  return packument.versions?.[version] ?? null;
}

function matchesPublishedArtifact(published, version, localIntegrity) {
  if (!published) return false;
  if (published.name !== packageJson.name || published.version !== version) {
    throw new Error('Registry returned a different package identity for the requested version.');
  }
  if (published.dist?.integrity !== localIntegrity) {
    throw new Error(`Version ${version} exists on npm, but its tarball integrity differs from this tag.`);
  }
  const provenance = published.dist?.attestations?.provenance;
  if (!provenance || typeof provenance !== 'object') {
    throw new Error(`Version ${version} exists on npm but has no provenance attestation; refusing to skip.`);
  }
  if (!published.dist?.attestations?.url) {
    throw new Error(`Version ${version} has no registry attestation URL; refusing to skip.`);
  }
  return true;
}

async function verifyPublished(version, localIntegrity, fetcher = fetch) {
  return matchesPublishedArtifact(await registryVersion(version, fetcher), version, localIntegrity);
}

function publishArgs(artifactPath) {
  return ['publish', artifactPath, '--registry', registry, '--access', 'public', '--provenance'];
}

function extractChangelogSection(changelog, version) {
  const lines = changelog.replaceAll('\r\n', '\n').split('\n');
  const heading = `## ${version}`;
  const matches = lines.flatMap((line, index) => line.trimEnd() === heading ? [index] : []);
  if (matches.length !== 1) throw new Error(`CHANGELOG.md must have one exact heading for ${version}; found ${matches.length}.`);
  const start = matches[0];
  const nextSection = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  const end = nextSection < 0 ? lines.length : nextSection;
  const section = lines.slice(start, end).join('\n').trim();
  if (!lines.slice(start + 1, end).some((line) => line.trim())) {
    throw new Error(`CHANGELOG.md section ${heading} is empty.`);
  }
  return section;
}

async function publishOrVerify(tag) {
  const version = packageJson.version;
  const artifact = await packedArtifact();
  try {
    if (await verifyPublished(version, artifact.integrity)) {
      console.log(`${packageJson.name}@${version} is already published with matching integrity and provenance.`);
      return;
    }
    run('npm', publishArgs(artifact.file));

    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (await verifyPublished(version, artifact.integrity)) {
        console.log(`Published ${packageJson.name}@${version} from ${tag} with matching integrity and provenance.`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error(`npm publish completed, but ${packageJson.name}@${version} did not become verifiable.`);
  } finally {
    await rm(artifact.file, { force: true });
  }
}

async function selfTest() {
  const goodTags = ['v1.0.0', 'v3.0.0', 'v12.34.56'];
  for (const tag of goodTags) {
    const version = tag.slice(1);
    if (validateVersionTag(tag, version) !== tag) throw new Error('Valid tag rejected.');
  }
  const badCases = [
    ['3.0.0', '3.0.0'],
    ['v03.0.0', '3.0.0'],
    ['v3.0.0-beta.1', '3.0.0-beta.1'],
    ['v3.0.0', '2.2.0'],
  ];
  for (const [tag, version] of badCases) {
    let rejected = false;
    try { validateVersionTag(tag, version); } catch { rejected = true; }
    if (!rejected) throw new Error(`Invalid tag/version pair accepted: ${tag} ${version}.`);
  }

  const provenanceUrl = 'https://registry.npmjs.org/-/npm/v1/attestations/@dfosco/lanes@3.0.0';
  const published = {
    name: '@dfosco/lanes',
    version: '3.0.0',
    dist: {
      integrity: 'sha512-local-tag-artifact',
      attestations: {
        url: provenanceUrl,
        provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
      },
    },
  };
  assert.equal(matchesPublishedArtifact(null, '3.0.0', published.dist.integrity), false);
  assert.equal(matchesPublishedArtifact(published, '3.0.0', published.dist.integrity), true);
  assert.throws(
    () => matchesPublishedArtifact(published, '3.0.0', 'sha512-different-artifact'),
    /integrity differs/,
  );
  assert.throws(
    () => matchesPublishedArtifact({ ...published, dist: { integrity: published.dist.integrity } }, '3.0.0', published.dist.integrity),
    /no provenance attestation/,
  );
  assert.deepEqual(publishArgs('/tmp/lanes-3.0.0.tgz'), [
    'publish', '/tmp/lanes-3.0.0.tgz', '--registry', registry, '--access', 'public', '--provenance',
  ]);

  let observedAccept;
  const mockFetch = async (url, options) => {
    observedAccept = options.headers.accept;
    assert.match(url, /%40dfosco%2flanes$/);
    return new Response(JSON.stringify({ versions: { '3.0.0': published } }), { status: 200 });
  };
  const fromMockRegistry = await registryVersion('3.0.0', mockFetch, '@dfosco/lanes');
  assert.equal(observedAccept, 'application/json');
  assert.equal(fromMockRegistry.version, '3.0.0');
  assert.equal(await verifyPublished('3.0.0', published.dist.integrity, mockFetch), true);
  assert.equal(await verifyPublished('3.0.1', published.dist.integrity, async () => (
    new Response(JSON.stringify({ versions: { '3.0.0': published } }), { status: 200 })
  )), false);

  const changelog = [
    '# Lanes', '',
    '## 3.0.0', '', '### Curated notes', '', '- Current release.', '',
    '## 2.2.0', '', '- Older release.', '',
  ].join('\n');
  assert.equal(
    extractChangelogSection(changelog, '3.0.0'),
    '## 3.0.0\n\n### Curated notes\n\n- Current release.',
  );
  assert.throws(() => extractChangelogSection(changelog, '3.0.1'), /one exact heading/);
  const preparedNotes = extractChangelogSection(await readFile(path.join(root, 'CHANGELOG.md'), 'utf8'), '3.0.0');
  assert.ok(preparedNotes.startsWith('## 3.0.0\n'));
  assert.ok(preparedNotes.includes('### Publishing'));
  assert.ok(!preparedNotes.includes('## 2.2.0'));
  console.log('Release tag validation self-test passed.');
}

const command = process.argv[2];
if (command === 'self-test') {
  await selfTest();
} else if (command === 'validate-and-checkout') {
  const tag = currentTag();
  await checkoutReleaseTag(tag);
  console.log(`Validated ${tag} against the package version and origin/main.`);
} else if (command === 'publish') {
  const tag = currentTag();
  await checkoutReleaseTag(tag);
  await publishOrVerify(tag);
} else if (command === 'notes') {
  const tag = currentTag();
  validateVersionTag(tag, packageJson.version);
  const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
  process.stdout.write(`${extractChangelogSection(changelog, packageJson.version)}\n`);
} else {
  console.error('Usage: node scripts/publish-release.js <publish|notes|self-test>');
  process.exitCode = 2;
}
