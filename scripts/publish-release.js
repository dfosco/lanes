#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registry = 'https://registry.npmjs.org';
const verificationTimeoutMs = 10 * 60 * 1000;
const verificationIntervalMs = 10 * 1000;
let packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
let registryLookupSequence = 0;
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
  const url = new URL(`${registry}/${encodedName}`);
  addFreshLookupParameter(url);
  const response = await fetcher(url, {
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      'cache-control': 'no-cache, no-store',
      pragma: 'no-cache',
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm registry lookup failed: HTTP ${response.status}.`);
  const packument = await response.json();
  return packument.versions?.[version] ?? null;
}

function inspectPublishedArtifact(published, version, localIntegrity) {
  if (!published) return 'missing';
  if (published.name !== packageJson.name || published.version !== version) {
    throw new Error('Registry returned a different package identity for the requested version.');
  }
  if (published.dist?.integrity !== localIntegrity) {
    throw new Error(`Version ${version} exists on npm, but its tarball integrity differs from this tag.`);
  }
  const provenance = published.dist?.attestations?.provenance;
  if (!provenance || typeof provenance !== 'object' || !published.dist?.attestations?.url) return 'pending';
  if (!published.dist?.tarball) return 'pending';
  return 'metadata-ready';
}

async function verifyPublished(version, localIntegrity, fetcher = fetch) {
  const published = await registryVersion(version, fetcher);
  const metadataStatus = inspectPublishedArtifact(published, version, localIntegrity);
  if (metadataStatus !== 'metadata-ready') return metadataStatus;

  const tarballUrl = new URL(published.dist.tarball);
  if (tarballUrl.protocol !== 'https:' || tarballUrl.origin !== registry) {
    throw new Error(`Version ${version} has an unexpected npm tarball URL.`);
  }
  addFreshLookupParameter(tarballUrl);
  const response = await fetcher(tarballUrl, {
    cache: 'no-store',
    headers: { 'cache-control': 'no-cache, no-store', pragma: 'no-cache' },
  });
  if (response.status === 404 || response.status >= 500) return 'pending';
  if (!response.ok) throw new Error(`npm tarball lookup failed: HTTP ${response.status}.`);

  const actualIntegrity = `sha512-${createHash('sha512').update(Buffer.from(await response.arrayBuffer())).digest('base64')}`;
  if (actualIntegrity !== localIntegrity) {
    throw new Error(`Version ${version} tarball bytes do not match this tag artifact's integrity.`);
  }
  return 'verified';
}

function addFreshLookupParameter(url) {
  url.searchParams.set('_release_check', `${Date.now()}-${registryLookupSequence += 1}`);
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

async function publishOrVerify(tag, {
  artifactLoader = packedArtifact,
  lookup = verifyPublished,
  publish = (artifact) => run('npm', publishArgs(artifact.file)),
  waitOptions = {},
  log = (...args) => console.log(...args),
} = {}) {
  const version = packageJson.version;
  const artifact = await artifactLoader();
  const wait = () => waitForPublished(version, artifact.integrity, { lookup, ...waitOptions });
  try {
    const initialStatus = await lookup(version, artifact.integrity);
    if (initialStatus === 'verified') {
      log(`${packageJson.name}@${version} is already published with matching integrity and provenance.`);
      return;
    }
    if (initialStatus === 'pending') {
      await wait();
      log(`${packageJson.name}@${version} is already published with matching integrity and provenance.`);
      return;
    }
    if (initialStatus !== 'missing') throw new Error(`Unexpected npm registry verification state: ${initialStatus}.`);

    try {
      await publish(artifact);
    } catch (publishError) {
      const statusAfterFailure = await lookup(version, artifact.integrity);
      if (statusAfterFailure === 'missing') throw publishError;
      if (statusAfterFailure === 'verified') {
        log(`${packageJson.name}@${version} already exists with matching integrity and provenance.`);
        return;
      }
      if (statusAfterFailure !== 'pending') {
        throw new Error(`Unexpected npm registry verification state: ${statusAfterFailure}.`, { cause: publishError });
      }
    }

    await wait();
    log(`Published or verified ${packageJson.name}@${version} from ${tag} with matching integrity and provenance.`);
  } finally {
    await rm(artifact.file, { force: true });
  }
}

async function waitForPublished(version, localIntegrity, {
  lookup = verifyPublished,
  now = () => performance.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = verificationTimeoutMs,
  intervalMs = verificationIntervalMs,
} = {}) {
  const deadline = now() + timeoutMs;
  while (true) {
    const status = await lookup(version, localIntegrity);
    if (status === 'verified') return;
    if (status !== 'missing' && status !== 'pending') {
      throw new Error(`Unexpected npm registry verification state: ${status}.`);
    }
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      throw new Error(`npm did not expose ${packageJson.name}@${version} with matching integrity, provenance, and a downloadable tarball within ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    await sleep(Math.min(intervalMs, remainingMs));
  }
}

async function selfTest() {
  const fixtureVersion = packageJson.version;
  const fixtureTag = `v${fixtureVersion}`;
  const fixtureName = packageJson.name;
  const encodedFixtureName = encodeURIComponent(fixtureName).replaceAll('%2F', '%2f');
  const goodTags = ['v1.0.0', fixtureTag, 'v12.34.56'];
  for (const tag of goodTags) {
    const version = tag.slice(1);
    if (validateVersionTag(tag, version) !== tag) throw new Error('Valid tag rejected.');
  }
  const badCases = [
    [fixtureVersion, fixtureVersion],
    [`v0${fixtureVersion}`, fixtureVersion],
    [`${fixtureTag}-beta.1`, `${fixtureVersion}-beta.1`],
    [fixtureTag, '0.0.0'],
  ];
  for (const [tag, version] of badCases) {
    let rejected = false;
    try { validateVersionTag(tag, version); } catch { rejected = true; }
    if (!rejected) throw new Error(`Invalid tag/version pair accepted: ${tag} ${version}.`);
  }

  const tarballBytes = Buffer.from('mock exact release tarball');
  const localIntegrity = `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}`;
  const provenanceUrl = `${registry}/-/npm/v1/attestations/${fixtureName}@${fixtureVersion}`;
  const published = {
    name: fixtureName,
    version: fixtureVersion,
    dist: {
      integrity: localIntegrity,
      tarball: `${registry}/${encodedFixtureName}/-/${fixtureName.split('/').at(-1)}-${fixtureVersion}.tgz`,
      attestations: {
        url: provenanceUrl,
        provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
      },
    },
  };
  assert.equal(inspectPublishedArtifact(null, fixtureVersion, localIntegrity), 'missing');
  assert.equal(inspectPublishedArtifact(published, fixtureVersion, localIntegrity), 'metadata-ready');
  assert.throws(
    () => inspectPublishedArtifact(published, fixtureVersion, 'sha512-different-artifact'),
    /integrity differs/,
  );
  assert.throws(
    () => inspectPublishedArtifact({ ...published, name: 'another-package' }, fixtureVersion, localIntegrity),
    /different package identity/,
  );
  assert.equal(
    inspectPublishedArtifact({ ...published, dist: { integrity: localIntegrity } }, fixtureVersion, localIntegrity),
    'pending',
  );
  const fixtureArtifactPath = `/tmp/lanes-${fixtureVersion}.tgz`;
  assert.deepEqual(publishArgs(fixtureArtifactPath), [
    'publish', fixtureArtifactPath, '--registry', registry, '--access', 'public', '--provenance',
  ]);

  let observedAccept;
  const lookupUrls = [];
  let tarballAvailable = false;
  let provenanceAvailable = true;
  let responseTarballBytes = tarballBytes;
  const mockFetch = async (url, options) => {
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['cache-control'], 'no-cache, no-store');
    const parsedUrl = new URL(url);
    assert.ok(parsedUrl.searchParams.has('_release_check'));
    lookupUrls.push(parsedUrl.toString());
    if (parsedUrl.pathname.endsWith('.tgz')) {
      return tarballAvailable
        ? new Response(responseTarballBytes, { status: 200 })
        : new Response(null, { status: 404 });
    }
    observedAccept = options.headers.accept;
    assert.equal(parsedUrl.pathname, `/${encodedFixtureName}`);
    const versionMetadata = provenanceAvailable
      ? published
      : { ...published, dist: { ...published.dist, attestations: undefined } };
    return new Response(JSON.stringify({ versions: { [fixtureVersion]: versionMetadata } }), { status: 200 });
  };
  const fromMockRegistry = await registryVersion(fixtureVersion, mockFetch, fixtureName);
  await registryVersion(fixtureVersion, mockFetch, fixtureName);
  assert.equal(observedAccept, 'application/json');
  assert.equal(fromMockRegistry.version, fixtureVersion);
  assert.notEqual(lookupUrls[0], lookupUrls[1]);
  assert.equal(await verifyPublished(fixtureVersion, localIntegrity, mockFetch), 'pending', 'a registry 404 for the tarball is still pending');
  tarballAvailable = true;
  assert.equal(await verifyPublished(fixtureVersion, localIntegrity, mockFetch), 'verified');
  responseTarballBytes = Buffer.from('incorrect tarball bytes');
  await assert.rejects(verifyPublished(fixtureVersion, localIntegrity, mockFetch), /tarball bytes do not match/);
  responseTarballBytes = tarballBytes;
  assert.equal(await verifyPublished(`${fixtureVersion}-missing`, localIntegrity, async () => (
    new Response(JSON.stringify({ versions: { [fixtureVersion]: published } }), { status: 200 })
  )), 'missing');

  const changelog = [
    '# Lanes', '',
    `## ${fixtureVersion}`, '', '### Curated notes', '', '- Current release.', '',
    '## 1.0.0', '', '- Older release.', '',
  ].join('\n');
  assert.equal(
    extractChangelogSection(changelog, fixtureVersion),
    `## ${fixtureVersion}\n\n### Curated notes\n\n- Current release.`,
  );
  assert.throws(() => extractChangelogSection(changelog, '9.9.9'), /one exact heading/);
  const preparedNotes = extractChangelogSection(await readFile(path.join(root, 'CHANGELOG.md'), 'utf8'), fixtureVersion);
  assert.ok(preparedNotes.startsWith(`## ${fixtureVersion}\n`));

  let fakeNow = 0;
  const fakeClock = {
    now: () => fakeNow,
    sleep: async (ms) => { fakeNow += ms; },
  };
  let lookupCount = 0;
  await waitForPublished(fixtureVersion, published.dist.integrity, {
    lookup: async () => (++lookupCount < 4 ? 'pending' : 'verified'),
    now: fakeClock.now,
    sleep: fakeClock.sleep,
    timeoutMs: 25_000,
    intervalMs: 10_000,
  });
  assert.equal(fakeNow, 25_000);
  assert.equal(lookupCount, 4);
  assert.equal(verificationTimeoutMs, 10 * 60 * 1000);

  fakeNow = 0;
  lookupCount = 0;
  await assert.rejects(waitForPublished(fixtureVersion, published.dist.integrity, {
    lookup: async () => (++lookupCount, 'pending'),
    now: fakeClock.now,
    sleep: fakeClock.sleep,
    timeoutMs: 25_000,
    intervalMs: 10_000,
  }), /downloadable tarball within 25 seconds/);
  assert.equal(fakeNow, 25_000);

  fakeNow = 0;
  await assert.rejects(waitForPublished(fixtureVersion, localIntegrity, {
    lookup: async () => { throw new Error('integrity differs'); },
    now: fakeClock.now,
    sleep: fakeClock.sleep,
    timeoutMs: 25_000,
    intervalMs: 10_000,
  }), /integrity differs/);
  assert.equal(fakeNow, 0, 'an integrity conflict fails without waiting');

  let publishCount = 0;
  fakeNow = 0;
  tarballAvailable = false;
  provenanceAvailable = false;
  const testArtifactDir = await mkdtemp(path.join(tmpdir(), 'lanes-release-selftest-'));
  try {
    await publishOrVerify(fixtureTag, {
      artifactLoader: async () => ({ file: path.join(testArtifactDir, 'existing.tgz'), integrity: localIntegrity }),
      lookup: async (version, integrity) => verifyPublished(version, integrity, mockFetch),
      publish: async () => { publishCount += 1; },
      waitOptions: {
        now: fakeClock.now,
        sleep: async (ms) => {
          fakeNow += ms;
          provenanceAvailable = true;
          if (fakeNow >= 20_000) tarballAvailable = true;
        },
        timeoutMs: 25_000,
        intervalMs: 10_000,
      },
      log: () => {},
    });
    assert.equal(publishCount, 0, 'an existing version with pending provenance and tarball must never be re-uploaded');

    fakeNow = 0;
    lookupCount = 0;
    publishCount = 0;
    await publishOrVerify(fixtureTag, {
      artifactLoader: async () => ({ file: path.join(testArtifactDir, 'missing.tgz'), integrity: localIntegrity }),
      lookup: async () => {
        lookupCount += 1;
        if (lookupCount === 1) return 'missing';
        if (lookupCount === 2) return 'pending';
        return 'verified';
      },
      publish: async () => { publishCount += 1; },
      waitOptions: { now: fakeClock.now, sleep: fakeClock.sleep, timeoutMs: 25_000, intervalMs: 10_000 },
      log: () => {},
    });
    assert.equal(publishCount, 1, 'a missing version is uploaded once, then only polled');
  } finally {
    provenanceAvailable = true;
    await rm(testArtifactDir, { recursive: true, force: true });
  }
  console.log('Release workflow self-test passed.');
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
