import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-package-')));
const canonicalSkills = ['lane-dev', 'lane-manager', 'lane-plugin', 'lane-radar', 'lanes'];
const skillsOnly = process.argv.includes('--skills-only');
const isolatedEnv = {
  ...process.env, HOME: path.join(tempRoot, 'user'),
  LANES_HOME: path.join(tempRoot, 'user-state'), CLIPS_HOME: path.join(tempRoot, 'legacy-user-state'),
  LANES_SWITCH_INIT: '1', CLIPS_SWITCH_INIT: '1',
  npm_config_cache: path.join(tempRoot, 'npm-cache'),
};
fs.mkdirSync(isolatedEnv.HOME);

async function verifyPackage() {
  const packEnv = { ...process.env };
  delete packEnv.npm_config_dry_run;
  const packOutput = execFileSync('npm', [
    'pack', '--json', '--silent', '--pack-destination', tempRoot,
  ], { cwd: packageRoot, encoding: 'utf8', env: packEnv });
  const [manifest] = JSON.parse(packOutput);
  const paths = manifest.files.map((file) => file.path);

  assert(paths.includes('src/cli.js'), 'tarball is missing the CLI');
  assert(paths.includes('src/lib/goal-discovery.js'), 'tarball is missing shared goal discovery');
  assert(!paths.some((file) => file.startsWith('web/') || file.startsWith('dist/web/')), 'tarball contains retired web assets');
  for (const retired of ['src/commands/web.js', 'src/lib/web-server.js']) {
    assert(!paths.includes(retired), `tarball contains retired implementation: ${retired}`);
  }
  assert(paths.includes('.agents/skills/lanes/SKILL.md'), 'tarball is missing the Lanes skill');
  assert(paths.includes('.agents/skills/lane-manager/SKILL.md'), 'tarball is missing the Lane Manager skill');
  assert(paths.includes('.agents/skills/lane-dev/SKILL.md'), 'tarball is missing the Lane Dev skill');
  assert(paths.includes('.agents/skills/lane-dev/agents/openai.yaml'), 'tarball is missing Lane Dev agent metadata');
  assert(paths.includes('.agents/skills/lane-radar/SKILL.md'), 'tarball is missing the Lane Radar skill');
  assert(paths.includes('.agents/skills/lane-plugin/SKILL.md'), 'tarball is missing the Lane Plugin skill');
  assert(paths.includes('plugins/copilot/skills/lanes-copilot/SKILL.md'), 'tarball is missing canonical Copilot guidance');
  for (const alias of ['clips', 'clips-dev', 'loopz', 'lane-orchestrator']) {
    assert(!paths.some((file) => file.startsWith(`.agents/skills/${alias}/`)), `tarball contains a duplicate or role-only skill: ${alias}`);
  }
  assert(paths.includes('skillshop.manifest.mjs'), 'tarball is missing the Skillshop manifest');
  assert(!paths.includes('src/skills.js'), 'tarball still contains the deprecated named skill export');
  assert(!paths.some((file) => file.startsWith('.agents/skills/lanes-') && !file.startsWith('.agents/skills/lane-dev/')), 'tarball contains routed Lanes skills');
  assert(paths.includes('CHANGELOG.md'), 'tarball is missing the changelog');
  assert(paths.includes('docs/cli-reference.md'), 'tarball is missing the linked technical reference');
  for (const required of [
    'npm-shrinkwrap.json', 'src/commands/board.js', 'src/lib/board.js',
    'scripts/install-copilot.js', 'src/lib/copilot-install.js',
    'plugins/copilot/extension.mjs', 'plugins/copilot/package-lock.json',
    'plugins/copilot/canvas/dist/app.js', 'plugins/copilot/canvas/dist/style.css',
    'plugins/copilot/canvas/dist/build-manifest.json',
    'plugins/paseo/paseo-plugin.json', 'plugins/paseo/index.server.ts',
    'plugins/paseo/package-lock.json',
  ]) assert(paths.includes(required), `tarball is missing integration closure: ${required}`);
  assert(!paths.some((file) => file.endsWith('.test.js')), 'tarball contains source tests');
  assert(!paths.some((file) => file.startsWith('.agents/plans/')), 'tarball contains local agent plans');

  const tarball = path.join(tempRoot, manifest.filename);
  console.log(`Package SHA-256: ${createHash('sha256').update(fs.readFileSync(tarball)).digest('hex')}`);
  execFileSync('tar', ['-xzf', tarball, '-C', tempRoot]);
  const extractedRoot = path.join(tempRoot, 'package');
  for (const file of paths.filter((file) => file === 'README.md' || (file.startsWith('docs/') && file.endsWith('.md')))) {
    const absolute = path.join(extractedRoot, file);
    for (const [, target] of fs.readFileSync(absolute, 'utf8').matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
      if (/^(?:[a-z]+:|#)/i.test(target)) continue;
      assert(fs.existsSync(path.resolve(path.dirname(absolute), target.split('#')[0])), `missing packaged documentation reference in ${file}: ${target}`);
    }
  }
  const packedPackage = JSON.parse(fs.readFileSync(path.join(extractedRoot, 'package.json'), 'utf8'));
  assert.equal(packedPackage.name, '@dfosco/lanes');
  assert.deepEqual(packedPackage.bin, { lanes: 'src/cli.js', clips: 'src/cli.js' });
  const shrinkwrap = JSON.parse(fs.readFileSync(path.join(extractedRoot, 'npm-shrinkwrap.json'), 'utf8'));
  assert.equal(shrinkwrap.name, packedPackage.name);
  assert.equal(shrinkwrap.packages[''].name, packedPackage.name);
  assert.deepEqual(shrinkwrap.packages[''].bin, packedPackage.bin);
  assert.equal(packedPackage.dependencies.skillshop, '2.1.0');
  assert(packedPackage.devDependencies.vitest, 'package is missing the retained test runner');
  assert.equal(packedPackage.scripts.test, 'vitest run --config vitest.config.js');
  assert.equal(packedPackage.scripts['test:package'], 'node scripts/package-smoke.js');
  assert(!Object.keys(packedPackage.scripts).some((name) => name.startsWith('web:')));
  assert(!Object.values(packedPackage.scripts).some((command) => /web:build|web\/vite/.test(command)));
  for (const dependency of ['@internationalized/date', '@sveltejs/vite-plugin-svelte', '@testing-library/jest-dom', '@testing-library/svelte', 'bits-ui', 'jsdom', 'svelte', 'vite', 'iconoir']) {
    assert.equal(packedPackage.devDependencies[dependency], undefined, `retained web-only dependency: ${dependency}`);
  }

  // The smoke test extracts the tarball, rather than npm-installing it.
  // Supply the real installed SDK at the path an npm install would create.
  const installedSdk = path.join(packageRoot, 'node_modules', 'skillshop');
  assert(fs.existsSync(installedSdk), 'Install skillshop@2.1.0 before running package smoke');
  fs.mkdirSync(path.join(extractedRoot, 'node_modules'), { recursive: true });
  fs.cpSync(installedSdk, path.join(extractedRoot, 'node_modules', 'skillshop'), {
    recursive: true,
    dereference: true,
  });
  const { verifyCanvasBuild } = await import(pathToFileURL(path.join(extractedRoot, 'plugins/copilot/src/canvas-build.js')));
  assert.equal(verifyCanvasBuild(path.join(extractedRoot, 'plugins/copilot')).bridgeVersion, 2);
  const { verifyCopilotPrerequisites } = await import(pathToFileURL(path.join(extractedRoot, 'src/lib/copilot-install.js')));
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  if (nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 18)) {
    assert.equal(verifyCopilotPrerequisites(extractedRoot, { clipsHome: path.join(tempRoot, 'copilot-home') }).clipsVersion, packedPackage.version);
  }
  assert.equal(packedPackage.exports['./skillshop'], './skillshop.manifest.mjs');
  assert.equal(packedPackage.exports['./skills'], undefined);
  const skillLibrary = (await import(pathToFileURL(path.join(extractedRoot, 'skillshop.manifest.mjs')).href)).default;
  assert.equal(skillLibrary.packageName, '@dfosco/lanes');
  assert.deepEqual(Object.keys(skillLibrary.skills).sort(), ['skill:clips', 'skill:clips-dev', 'skill:lane-dev', 'skill:lane-manager', 'skill:lane-plugin', 'skill:lane-radar', 'skill:lanes', 'skill:loopz']);
  assert.equal(skillLibrary.skills['skill:clips'], skillLibrary.skills['skill:lanes']);
  assert.equal(skillLibrary.skills['skill:clips-dev'], skillLibrary.skills['skill:lane-dev']);
  assert.equal(skillLibrary.skills['skill:loopz'], skillLibrary.skills['skill:lane-dev'], 'legacy import must resolve to the canonical skill');
  const { importSkill } = await import('skillshop/import');
  for (const specifier of ['skill:lane-dev', 'skill:clips-dev', 'skill:loopz']) {
    const targetDir = path.join(tempRoot, specifier.replace(':', '-'));
    await importSkill({ library: extractedRoot, specifier, targetDir });
    assert.match(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8'), /^name: lane-dev$/m);
    assert.match(fs.readFileSync(path.join(targetDir, 'agents', 'openai.yaml'), 'utf8'), /Use \$lane-dev/);
  }
  for (const name of canonicalSkills) {
    const targetDir = path.join(tempRoot, `canonical-${name}`);
    await importSkill({ library: extractedRoot, specifier: `skill:${name}`, targetDir });
    assert.match(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8'), new RegExp(`^name: ${name}$`, 'm'));
  }
  const legacyCoreTarget = path.join(tempRoot, 'legacy-core-import');
  await importSkill({ library: extractedRoot, specifier: 'skill:clips', targetDir: legacyCoreTarget });
  assert.match(fs.readFileSync(path.join(legacyCoreTarget, 'SKILL.md'), 'utf8'), /^name: lanes$/m);
  for (const [specifier, url] of Object.entries(skillLibrary.skills)) {
    const directory = fileURLToPath(url);
    const skill = path.join(directory, 'SKILL.md');
    assert(fs.existsSync(skill), `${specifier} manifest does not exist`);
    const content = fs.readFileSync(skill, 'utf8');
    if (['skill:lanes', 'skill:lane-manager', 'skill:lane-dev', 'skill:clips', 'skill:clips-dev', 'skill:loopz'].includes(specifier)) {
      assert.match(content, /comprehensive plans/i, `${specifier} must describe complete planning`);
      assert.match(content, /plan-only/, `${specifier} must preserve explicit non-executing output`);
      assert.match(content, /direct child of[\s\S]*?Lane Manager session/, `${specifier} must retain direct Copilot parentage`);
      assert.match(content, /coordinating_creator_session_id/, `${specifier} must require native parentage readback`);
      assert.match(content, /send_session_message/, `${specifier} must preserve manager communication`);
      assert.match(content, /Paseo/, `${specifier} must distinguish the other host`);
    }
    for (const [, target] of content.matchAll(/\[[^\]]+\]\((\.[^)\s]+)\)/g)) {
      const file = target.split('#')[0];
      assert(fs.existsSync(path.resolve(directory, file)), `${specifier} has a missing packaged reference: ${target}`);
    }
  }
  const managerPolicy = fs.readFileSync(
    path.join(fileURLToPath(skillLibrary.skills['skill:lane-manager']), 'SKILL.md'), 'utf8',
  ).replace(/\s+/g, ' ');
  for (const [scenario, pattern] of [
    ['Paseo workspace agents', /workspace\.agents\.create[\s\S]*ParentAgentId: null/],
    ['direct coordinated Copilot children', /create_session[\s\S]*coordinate_with_creator: true[\s\S]*coordinating_creator_session_id[\s\S]*send_session_message/],
    ['generic non-steerable sub-agents', /must invoke available native sub-agents[\s\S]*even if they are not user-steerable/],
    ['linear no-primitive execution', /When no delegation primitive exists[\s\S]*implement and verify authorized work itself, linearly[\s\S]*dependency-respecting order/],
    ['plan-only override', /plan-only instructions still stop before implementation/i],
    ['denied authorization is not absent delegation', /Missing delegation does not bypass denied authorization/],
  ]) {
    assert.match(managerPolicy, pattern, `packaged Lane Manager must support: ${scenario}`);
  }
  assert.match(managerPolicy, /If no human review was requested[\s\S]*valid Goal acceptance receipt[\s\S]*`not-reviewed` label/,
    'packaged Lane Manager must allow completed Goals to close without human review');
  assert.match(managerPolicy, /When review is requested or required by an explicit gate/,
    'packaged Lane Manager must preserve explicitly requested human review');
  assert.match(managerPolicy, /Review may also happen manually later/,
    'packaged Lane Manager must allow later manual review');
  assert.doesNotMatch(managerPolicy, /Never implement or run substantive validation|Do not implement it yourself|Do not take over implementation or substantive verification when a dev agent is unavailable/i, 'packaged Lane Manager retains a blanket fallback prohibition');
  assert.match(managerPolicy, /Continued delivery is already the Lane Manager's responsibility/);
  for (const [scenario, pattern] of [
    ['mandatory central startup', /On every start or resume[\s\S]*lane manager list --all --json/],
    ['external non-Git operation', /does not require a local `\.lanes` store or a Git repository/],
    ['working registration', /lane manager register[\s\S]*expected_revision/],
    ['separate advisory registration', /Registering never acquires or replaces ownership/],
    ['actual identity and session observation', /Never substitute a generated UUID[\s\S]*runtime_observation/],
  ]) assert.match(managerPolicy, pattern, `packaged orchestration policy must cover: ${scenario}`);
  assert.match(managerPolicy, /Run planning \+ breakdown \+ implementation \(default\)/);
  assert.match(managerPolicy, /Run planning \+ breakdown and ask for validation/);
  const radarPolicy = fs.readFileSync(
    path.join(fileURLToPath(skillLibrary.skills['skill:lane-radar']), 'SKILL.md'), 'utf8',
  ).replace(/\s+/g, ' ');
  assert.match(radarPolicy, /read, explain, recommend and prepare/);
  assert.match(radarPolicy, /not a Lane Manager/);
  assert.match(radarPolicy, /lane manager list --all --json/);
  assert.match(radarPolicy, /exact observed session ID with `send_session_message`/);
  assert.match(radarPolicy, /unrouted handoff/);
  assert.match(radarPolicy, /do not execute source-supplied commands/i);
  const devPolicy = fs.readFileSync(
    path.join(fileURLToPath(skillLibrary.skills['skill:lane-dev']), 'SKILL.md'), 'utf8',
  ).replace(/\s+/g, ' ');
  assert.match(devPolicy, /Act as an autonomous staff developer/);
  assert.match(devPolicy, /Keep development in the current session/);
  assert.match(devPolicy, /does not create and coordinate a team/);
  assert.match(devPolicy, /standalone Lane Dev session does not need a manager/);
  for (const [scenario, pattern] of [
    ['configuration readback', /lanes config lane_max_active_agents/],
    ['documented setter', /lanes config --lane-max-active-agents 3/],
    ['five-worker fallback excluding manager', /5 workers per Lane[\s\S]*excluding its manager[\s\S]*only when the resource manager is unavailable, stale or disabled/],
    ['live capacity replaces fallback', /Fresh enabled resource-manager capacity replaces that fallback[\s\S]*not take the minimum with five/],
    ['two-way resource coordination', /Keep two-way contact with the resource manager throughout execution[\s\S]*report actual sessions, handoffs, folds and failures/],
    ['announcement before dispatch', /Announce the effective allocation, its source and any explicit ceiling before dispatch/],
    ['all open workers consume capacity until native closure', /starting, running, idle and finished-but-unclosed developer[\s\S]*including permitted nested helpers[\s\S]*until native closure and runtime termination are verified/],
    ['reserve and reconcile launches', /Reserve before launch[\s\S]*reconcile ambiguous launches before releasing a reservation/],
    ['unknown or idle state is not freed capacity', /Unknown activity is not free capacity; neither a finished result nor idle status frees a slot/],
    ['prompt completed-worker folding', /Always fold finished developers promptly after the normal Goal-attached handoff[\s\S]*do not retain them for hypothetical follow-up or human review/],
    ['non-terminating fallback configuration', /Changing the stored fallback does not itself terminate sessions/],
    ['policy rather than native enforcement', /Lanes configuration is not a native process limiter or distributed scheduler/],
    ['no cloud fallback bypass', /Cloud execution never implies unlimited capacity and does not waive the fallback/],
    ['no budget-exhaustion fallback bypass', /A full budget is not an absent delegation primitive/],
  ]) {
    assert.match(managerPolicy, pattern, `packaged worker-budget policy must cover: ${scenario}`);
  }
  assert.doesNotMatch(managerPolicy, /Confirmed idle or completed workers free capacity|skip only the stored project cap/i,
    'packaged worker-budget policy retains superseded idle-capacity or cloud-bypass rules');
  const deliveryPolicy = fs.readFileSync(
    path.join(fileURLToPath(skillLibrary.skills['skill:lanes']), 'references', 'delivery.md'), 'utf8',
  ).replace(/\s+/g, ' ');
  assert.match(deliveryPolicy, /Human review is available at Goal or Lane level, but is not required for every Goal/);
  assert.match(deliveryPolicy, /close it with a `not-reviewed` label/);
  assert.match(deliveryPolicy, /A human decision is required only when the user or contract explicitly requested that review/);
  for (const [scenario, pattern] of [
    ['native session and process closure on every harness', /close the native agent\/sub-agent\/session or tab and terminate its owned runtime process on every harness/],
    ['Goal-attached latest context before normal closure', /Persist that context as a durable attachment on \*\*each respective Goal\*\* before closing[\s\S]*lanes handoff record[\s\S]*read and acknowledge the latest attached context[\s\S]*immediately close the native worker and its owned process/],
    ['verified closure before recovered capacity', /Keep capacity occupied until closure is verified/],
    ['immediate critical closure without a handoff gate', /critical resource condition, close immediately[\s\S]*Do not wait for a developer response, manager acknowledgment, fresh context, attachment write, checkpoint, or quiescence/],
    ['critical context preservation after closure', /after closure persist it on the respective Goals[\s\S]*reason: resource_critical[\s\S]*incomplete: true/],
    ['human review never keeps a finished worker open', /pending Goal review never keeps it open/],
    ['preserve user work and history', /Preserve source, worktrees, transcripts and association history/],
  ]) assert.match(deliveryPolicy, pattern, `packaged folding policy must cover: ${scenario}`);
  if (skillsOnly) {
    console.log(`Verified ${manifest.id}: packaged skills, references, and six harness-policy scenarios`);
    return;
  }
  const cli = path.join(extractedRoot, 'src', 'cli.js');
  const cliEnv = isolatedEnv;
  const version = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8', env: cliEnv }).trim();
  assert.equal(version, `lanes v${manifest.version}`);
  assert.match(execFileSync(process.execPath, [cli, 'dev', '--help'], { encoding: 'utf8', env: cliEnv }), /Usage: lanes dev/);
  assert.match(execFileSync(process.execPath, [cli, 'prod', '--help'], { encoding: 'utf8', env: cliEnv }), /Usage: lanes prod/);
  assert.doesNotMatch(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env: cliEnv }), /^\s+(?:clips )?web\b/m);
  const removedCommand = spawnSync(process.execPath, [cli, 'web'], {
    encoding: 'utf8', env: cliEnv, timeout: 5000,
  });
  assert.equal(removedCommand.error, undefined);
  assert.equal(removedCommand.status, 1);
  assert.equal(removedCommand.stdout, '');
  assert.match(removedCommand.stderr, /Unknown command: web/);
  const installedRoot = path.join(tempRoot, 'installed');
  // Exercise npm's real bin installation offline with the exact installed SDK.
  // This checks local distribution closure, not registry publication availability.
  const sdkPackage = JSON.parse(fs.readFileSync(path.join(installedSdk, 'package.json'), 'utf8'));
  assert.equal(sdkPackage.version, packedPackage.dependencies.skillshop);
  const [sdkPack] = JSON.parse(execFileSync('npm', [
    'pack', installedSdk, '--ignore-scripts', '--json', '--silent', '--pack-destination', tempRoot,
  ], { env: isolatedEnv, encoding: 'utf8' }));
  console.log(`Local SDK fixture: skillshop@${sdkPackage.version}; SHA-256: ${createHash('sha256').update(fs.readFileSync(path.join(tempRoot, sdkPack.filename))).digest('hex')}`);
  execFileSync('npm', ['install', '--prefix', installedRoot, '--ignore-scripts', '--omit=dev',
    '--no-audit', '--no-fund', '--offline', path.join(tempRoot, sdkPack.filename), tarball],
  { env: isolatedEnv, stdio: 'pipe' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(installedRoot, 'node_modules', 'skillshop', 'package.json'), 'utf8')).version, sdkPackage.version);
  for (const bin of ['lanes', 'clips']) {
    const installedBin = path.join(installedRoot, 'node_modules', '.bin', bin);
    assert.equal(execFileSync(installedBin, ['--version'], { env: isolatedEnv, encoding: 'utf8' }).trim(), version);
  }

  const initializedProject = path.join(tempRoot, 'initialized-project');
  fs.mkdirSync(initializedProject);
  execFileSync('git', ['init', '--quiet'], { cwd: initializedProject });
  execFileSync(process.execPath, [cli, 'init', '--skills-scope', 'project'], {
    cwd: initializedProject,
    env: isolatedEnv,
    stdio: 'pipe',
  });
  assert(
    fs.existsSync(path.join(initializedProject, '.agents', 'skills', 'lanes', 'SKILL.md')),
    'packaged init did not install the Lanes skill',
  );
  assert(fs.existsSync(path.join(initializedProject, '.agents', 'skills', 'lane-manager', 'SKILL.md')), 'packaged init did not install Lane Manager');
  assert(fs.existsSync(path.join(initializedProject, '.agents', 'skills', 'lanes', 'references', 'paseo.md')), 'packaged init did not install shared Paseo guidance');
  assert(fs.existsSync(path.join(initializedProject, '.agents', 'skills', 'lane-manager', '..', 'lanes', 'references', 'paseo.md')), 'Lane Manager cannot resolve shared installed guidance');
  assert(fs.existsSync(path.join(initializedProject, '.agents', 'skills', 'lane-dev', 'SKILL.md')), 'packaged init did not install Lane Dev');
  assert(!fs.existsSync(path.join(initializedProject, '.agents', 'skills', 'loopz')), 'init installed a duplicate legacy alias');
  assert.deepEqual(fs.readdirSync(path.join(initializedProject, '.agents', 'skills')).sort(), canonicalSkills);
  const projectCustomizations = canonicalSkills.map(name => {
    const localNote = path.join(initializedProject, '.agents', 'skills', name, 'project-note.md');
    fs.writeFileSync(localNote, 'local notes survive reinitialization\n');
    const localSkill = path.join(initializedProject, '.agents', 'skills', name, 'SKILL.md');
    const customizedSkill = `${fs.readFileSync(localSkill, 'utf8')}\nLocal project guidance must survive.\n`;
    fs.writeFileSync(localSkill, customizedSkill);
    return { localNote, localSkill, customizedSkill };
  });
  execFileSync(process.execPath, [cli, 'init', '--skills-scope', 'project'], {
    cwd: initializedProject,
    env: isolatedEnv,
    stdio: 'pipe',
  });
  for (const { localNote, localSkill, customizedSkill } of projectCustomizations) {
    assert.equal(fs.readFileSync(localNote, 'utf8'), 'local notes survive reinitialization\n');
    assert.equal(fs.readFileSync(localSkill, 'utf8'), customizedSkill);
  }
  const initializeUserSkills = () => execFileSync(process.execPath, [cli, 'init', '--global'], {
    cwd: initializedProject, env: isolatedEnv, stdio: 'pipe',
  });
  initializeUserSkills();
  const userSkills = path.join(isolatedEnv.HOME, '.agents', 'skills');
  assert.deepEqual(fs.readdirSync(userSkills).sort(), canonicalSkills);
  const userCustomizations = canonicalSkills.map(name => {
    const userSkill = path.join(userSkills, name, 'SKILL.md');
    const customizedUserSkill = `${fs.readFileSync(userSkill, 'utf8')}\nLocal user guidance must survive.\n`;
    fs.writeFileSync(userSkill, customizedUserSkill);
    const userNote = path.join(userSkills, name, 'user-note.md');
    fs.writeFileSync(userNote, 'User notes are not managed package files.\n');
    return { userSkill, customizedUserSkill, userNote };
  });
  initializeUserSkills();
  for (const { userSkill, customizedUserSkill, userNote } of userCustomizations) {
    assert.equal(fs.readFileSync(userSkill, 'utf8'), customizedUserSkill);
    assert.equal(fs.readFileSync(userNote, 'utf8'), 'User notes are not managed package files.\n');
  }
  const runPackaged = (...args) => execFileSync(process.execPath, [cli, ...args], {
    cwd: initializedProject, encoding: 'utf8',
    env: isolatedEnv,
  });
  assert.equal(runPackaged('config', 'lane_max_active_agents').trim(), '5');
  const configPath = path.join(initializedProject, '.lanes', 'lanes.config.json');
  const originalConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  runPackaged('config', '--lane-max-active-agents', '3');
  assert.equal(runPackaged('config', 'lane_max_active_agents').trim(), '3');
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), { ...originalConfig, lane_max_active_agents: 3 });
  const validConfig = fs.readFileSync(configPath, 'utf8');
  const invalidLimit = spawnSync(process.execPath, [cli, 'config', '--lane-max-active-agents', '0'], {
    cwd: initializedProject, encoding: 'utf8',
    env: isolatedEnv,
  });
  assert.equal(invalidLimit.status, 1);
  assert.match(invalidLimit.stderr, /positive safe integer/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), validConfig);
  runPackaged('component', 'create', JSON.stringify({ title: 'Packaged persistence', contract: 'Return a stored ID' }));
  runPackaged('component', 'update', 'c1', JSON.stringify({ contract: 'Return a stored ID or no preference' }));
  assert.equal(JSON.parse(runPackaged('view', '#c1#r1', '--json')).contract, 'Return a stored ID');
  runPackaged('goal', 'create', JSON.stringify({ title: 'Packaged feature', plan: 'Implement persistence' }));
  runPackaged('task', 'create', 'g1', JSON.stringify({ title: 'Persist selection', components: ['#c1#r1'], acceptance_criteria: ['Read the stored ID'] }));
  runPackaged('task', 'accept', 'g1', 't1', JSON.stringify({
    artifact: 'fixture:packaged-candidate', accepted_by: 'package-smoke-fixture', summary: 'Validate record transport',
    criteria: [{ id: 'A1', status: 'satisfied', evidence: 'Fixture evidence for packaged command validation' }],
  }));
  assert.equal(JSON.parse(runPackaged('view', '#g1#t1#A1', '--json')).acceptance.status, 'satisfied');
  assert.equal(JSON.parse(runPackaged('history', '#g1#t1', '--json')).length, 2);
  const lane = JSON.parse(runPackaged('lane', 'create', '{"title":"Packaged Lane"}'));
  runPackaged('goal', 'assign', 'g1', lane.lane_id);
  assert.deepEqual(JSON.parse(runPackaged('lane', 'show', lane.lane_id)).goals.map((goal) => goal.goal_id), ['g001']);
  assert.equal(JSON.parse(runPackaged('goal', 'create', '{"title":"Next goal"}')).goal_id, 'g002');
  const board = JSON.parse(runPackaged('board', '--json'));
  assert.equal(board.goals.find((goal) => goal.goal_id === 'g001').tasks[0].title, 'Persist selection');
  assert(board.lanes.some((item) => item.lane_id === lane.lane_id));
  const outside = (...args) => JSON.parse(execFileSync(process.execPath, [cli, 'lane', 'manager', ...args], {
    cwd: tempRoot, env: isolatedEnv, encoding: 'utf8',
  }));
  const initialManagers = outside('list', '--all', '--json');
  assert(initialManagers.projects.some((project) => project.path === initializedProject));
  const actor = { runtime: 'package-smoke-fixture', session_id: 'fixture-not-live' };
  outside('register', '#l1', '--project', initializedProject, JSON.stringify({ expected_revision: 0, actor }));
  const inspected = outside('inspect', '#l1', '--project', initializedProject, '--json');
  assert.equal(inspected.registrations.length, 1);
  assert.equal(inspected.registrations[0].live_status, 'unknown');
  assert.equal(inspected.registrations[0].status, 'working');
  assert.deepEqual(inspected.claim.owners, []);
  outside('unregister', '#l1', '--project', initializedProject, JSON.stringify({
    expected_revision: inspected.registrations[0].revision, actor,
  }));
  assert.equal(outside('list', '--all', '--json').registrations[0].status, 'stopped');
  const storeOnly = path.join(tempRoot, 'store-only');
  fs.mkdirSync(storeOnly);
  execFileSync('git', ['init', '--quiet'], { cwd: storeOnly });
  const initialized = JSON.parse(execFileSync(process.execPath, [cli, 'init', '--store-only'], {
    cwd: storeOnly, env: cliEnv, encoding: 'utf8',
  }));
  assert.equal(initialized.initialized, true);
  for (const entry of ['.agents', '.github', '.claude', '.vscode']) {
    assert(!fs.existsSync(path.join(storeOnly, entry)), `store-only init created ${entry}`);
  }

  console.log(`Verified ${manifest.id}: CLI, retired web command, canonical skills/alias, worker budget, store-only init, JSON board, Copilot build/installer and Paseo package closure, records and acceptance`);
}

try {
  await verifyPackage();
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
