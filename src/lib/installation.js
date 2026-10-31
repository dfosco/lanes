import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getSystemClipsDir } from './registry.js';
import { findLiveSkill, isLiveSkill } from './lane-manager-install.js';
import { getRepoRoot } from './core.js';
import { readConfig } from './config.js';
import { readJsonObject } from './storage-paths.js';
import { migrateStorage } from './storage-migration.js';
import { withRecordLock } from './journal.js';

const PACKAGE_NAME = '@dfosco/lanes';
const LEGACY_PACKAGE_NAME = '@dfosco/clips';
const CHECKOUT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function statePath() {
  return path.join(getSystemClipsDir(), 'installation.json');
}

function readState() {
  try { return readJsonObject(statePath()); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

function writeState(state) {
  const file = statePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd, env: options.env || process.env, encoding: 'utf8', stdio: options.stdio || ['inherit', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr?.trim() || `${command} ${args.join(' ')} exited with ${result.status}`);
  }
  return result.stdout?.trim() || '';
}

function packageAt(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (![PACKAGE_NAME, LEGACY_PACKAGE_NAME].includes(manifest.name) || !fs.existsSync(path.join(root, 'src', 'cli.js'))) return null;
    return { root: fs.realpathSync(root), version: manifest.version, name: manifest.name };
  } catch { return null; }
}

function fileDigests(root) {
  const files = {};
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files[path.relative(root, file)] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      else throw new Error(`Unsupported skill source entry: ${file}`);
    }
  };
  walk(root);
  return files;
}

export function refreshManagedSkill(source, target, { project, agentDir } = {}) {
  const state = readState();
  const previous = state.skill_installations?.[target]?.files || {};
  const projectReceipt = state.projects?.[project];
  const prefix = `${path.basename(target)}${path.sep}`;
  const switched = (projectReceipt?.agent_dir || '.agents') === agentDir
    ? Object.fromEntries(Object.entries(projectReceipt?.files || {}).filter(([file]) => file.startsWith(prefix)).map(([file, digest]) => [file.slice(prefix.length), digest]))
    : {};
  const selected = fileDigests(source);
  const files = { ...previous };
  let installed = false;
  let updated = false;
  for (const [relative, digest] of Object.entries(selected)) {
    const file = path.join(target, relative);
    let cursor = target;
    let linked = false;
    for (const segment of relative.split(path.sep)) {
      cursor = path.join(cursor, segment);
      try { if (fs.lstatSync(cursor).isSymbolicLink()) { linked = true; break; } }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (linked) {
      console.error(`Retained linked skill file: ${file}`);
      continue;
    }
    if (fs.existsSync(file)) {
      if (!fs.statSync(file).isFile()) throw new Error(`Skill target is not a file: ${file}`);
      const actual = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      if (actual === digest) { files[relative] = digest; continue; }
      if (actual !== previous[relative] && actual !== switched[relative]) {
        console.error(`Retained modified or unmanaged skill file: ${file}`);
        continue;
      }
      updated = true;
    } else installed = true;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.join(source, relative), file);
    files[relative] = digest;
  }
  return { targetDir: target, installed, updated, files };
}

export function recordSkillInstallations(receipts) {
  if (!Object.keys(receipts).length) return;
  return withRecordLock(statePath(), () => {
    const state = readState();
    writeState({ ...state, skill_installations: { ...state.skill_installations, ...receipts } });
  });
}

function skillFiles(packageRoot) {
  const skillsRoot = path.join(packageRoot, '.agents', 'skills');
  if (!fs.existsSync(skillsRoot)) return {};
  const libraryFile = path.join(packageRoot, 'skillshop.library.json');
  const exported = fs.existsSync(libraryFile)
    ? new Set(Object.keys(JSON.parse(fs.readFileSync(libraryFile, 'utf8')).exports).map((name) => name.replace(/^skill:/, '')))
    : null;
  const files = {};
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        const relative = path.relative(skillsRoot, file);
        files[relative] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      }
    }
  };
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && (exported ? exported.has(entry.name) : true)) walk(path.join(skillsRoot, entry.name));
  }
  return files;
}

export function reconcileSkills(project, previous = {}, selected = {}, agentDir = '.agents') {
  const root = path.resolve(project, agentDir, 'skills');
  if (!root.startsWith(`${project}${path.sep}`)) throw new Error(`Agent directory is outside project: ${agentDir}`);
  for (const [relative, digest] of Object.entries(previous)) {
    if (Object.hasOwn(selected, relative)) continue;
    if (path.isAbsolute(relative) || relative.split(/[/\\]/).includes('..')) throw new Error(`Invalid managed skill path: ${relative}`);
    if (isLiveSkill(path.join(root, relative.split(path.sep)[0]))) continue;
    const file = path.join(root, relative);
    if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.lstatSync(file).isFile()) continue;
    let parent = path.dirname(file);
    let linked = false;
    while (parent !== root) {
      if (fs.lstatSync(parent).isSymbolicLink()) { linked = true; break; }
      parent = path.dirname(parent);
    }
    if (linked) {
      console.error(`Retained linked skill file: ${file}`);
      continue;
    }
    const actual = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (actual !== digest) {
      console.error(`Retained modified skill file: ${file}`);
      continue;
    }
    fs.rmSync(file);
    let directory = path.dirname(file);
    while (directory !== root && fs.existsSync(directory) && fs.readdirSync(directory).length === 0) {
      fs.rmdirSync(directory);
      directory = path.dirname(directory);
    }
  }
}

export function retireLegacySkillCopies(project, agentDir = '.agents') {
  const receipt = readState().projects?.[fs.realpathSync(project)];
  if ((receipt?.agent_dir || '.agents') !== agentDir) return;
  const previous = receipt?.files || {};
  const legacy = Object.fromEntries(Object.entries(previous).filter(([file]) => ['clips', 'clips-dev'].includes(file.split(path.sep)[0])));
  reconcileSkills(project, legacy, {}, agentDir);
}

function globalPackagePaths() {
  const root = run('npm', ['root', '-g']);
  return ['lanes', 'clips'].map(name => path.join(root, '@dfosco', name));
}

function saveInstalledPackage(globalPath, state) {
  if (!fs.existsSync(globalPath) || fs.lstatSync(globalPath).isSymbolicLink()) return state;
  const installed = packageAt(globalPath);
  if (!installed) throw new Error(`Global ${PACKAGE_NAME} installation is incomplete: ${globalPath}`);
  const destination = path.join(getSystemClipsDir(), 'installations', 'prod', installed.name === LEGACY_PACKAGE_NAME ? 'clips' : 'lanes', installed.version);
  if (fs.existsSync(destination)) {
    const saved = packageAt(destination);
    if (!saved || saved.name !== installed.name || saved.version !== installed.version) {
      throw new Error(`Saved package conflicts with ${installed.name}@${installed.version}: ${destination}. Repair it explicitly before switching.`);
    }
  }
  if (!fs.existsSync(destination)) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    fs.cpSync(installed.root, temporary, { recursive: true, dereference: true });
    fs.renameSync(temporary, destination);
  }
  return { ...state, prod_package: destination, prod_version: installed.version };
}

function devCheckout(args, state) {
  const explicit = args.checkout || process.env.LANES_DEV_PATH || process.env.CLIPS_DEV_PATH;
  const candidates = explicit ? [explicit] : [state.dev_checkout, CHECKOUT_ROOT].filter(Boolean);
  let lastError;
  for (const candidate of [...new Set(candidates)]) {
    let root;
    try {
      root = fs.realpathSync(path.resolve(candidate));
      const manifest = packageAt(root);
      if (manifest?.name === PACKAGE_NAME && fs.existsSync(path.join(root, '.git'))) return root;
      lastError = new Error(`Lanes development checkout is not a Lanes Git repository: ${root}`);
    } catch (error) {
      lastError = error;
    }
    if (explicit) break;
  }
  const requested = explicit || state.dev_checkout || CHECKOUT_ROOT;
  throw new Error(`Lanes development checkout not found: ${requested}. ${lastError?.message || ''} Pass --checkout <path> to select a checkout.`.trim());
}

function parseSwitchArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--checkout' || arg === '--project') {
      if (!argv[i + 1]) throw new Error(`${arg} requires a path`);
      result[arg.slice(2)] = argv[++i];
    } else if (arg === '--help' || arg === '-h') result.help = true;
    else throw new Error(`Unknown installation option: ${arg}`);
  }
  return result;
}

export function switchInstallation(mode, argv = []) {
  const args = parseSwitchArgs(argv);
  if (args.help) {
    console.log(`Usage: lanes ${mode} [--project <repo>]${mode === 'dev' ? ' [--checkout <lanes-repo>]' : ''}`);
    return;
  }
  // init writes to the common repository root, including from nested worktrees.
  const project = fs.realpathSync(getRepoRoot(path.resolve(args.project || process.cwd())));
  const agentDir = readConfig(project, { strict: true }).agent_dir || '.agents';
  // A saved older CLI may not understand live links. Refuse before invoking it.
  const liveProject = findLiveSkill(path.resolve(project, agentDir, 'skills'));
  if (mode === 'prod' && liveProject) {
    const title = liveProject === 'lane-manager' ? 'Lane Manager' : 'Lanes';
    throw new Error(`Cannot refresh production skills over a live ${title} source. Keep the live installation or choose a project without that source link.`);
  }
  migrateStorage(project);
  const [globalPath, legacyGlobalPath] = globalPackagePaths();
  let state = saveInstalledPackage(fs.existsSync(globalPath) ? globalPath : legacyGlobalPath, readState());
  const checkout = devCheckout(args, state);
  const devCli = path.join(checkout, 'src', 'cli.js');
  const prod = state.prod_package && packageAt(state.prod_package);
  if (!prod) throw new Error('No locally installed npm package was found. Install @dfosco/lanes once before switching modes.');
  if (mode === 'prod' && prod.name === LEGACY_PACKAGE_NAME) {
    throw new Error('The saved Clips release cannot safely use Lanes stores. Install @dfosco/lanes before switching to production; the legacy package has been preserved.');
  }
  if (!fs.existsSync(globalPath) || fs.realpathSync(globalPath) !== checkout) {
    run('npm', ['link'], { cwd: checkout });
    if (!fs.existsSync(globalPath) || fs.realpathSync(globalPath) !== checkout) {
      throw new Error(`npm link did not point ${globalPath} at ${checkout}`);
    }
  }
  const activeCli = mode === 'dev' ? devCli : path.join(prod.root, 'src', 'cli.js');
  run(process.execPath, [activeCli, 'init', '--skills-scope', 'project'], { cwd: project, stdio: 'inherit', env: { ...process.env, LANES_SWITCH_INIT: '1', CLIPS_SWITCH_INIT: '1' } });
  const selectedRoot = mode === 'dev' ? checkout : prod.root;
  const selectedFiles = skillFiles(selectedRoot);
  reconcileSkills(project, state.projects?.[project]?.files, selectedFiles, agentDir);
  const refreshed = readState();
  state = { ...refreshed, ...state, skill_installations: refreshed.skill_installations, mode, dev_checkout: checkout,
    projects: { ...state.projects, [project]: { files: selectedFiles, agent_dir: agentDir } } };
  writeState(state);
  console.log(`Lanes ${mode}: ${mode === 'dev' ? checkout : `${prod.root} (${prod.version})`}`);
}

export function dispatchProd(argv) {
  // Migration and path discovery must use this runtime, not an older saved CLI.
  if (['init', 'paths', 'upgrade'].includes(argv[0]) || process.env.LANES_SWITCH_INIT === '1' || process.env.CLIPS_SWITCH_INIT === '1') return null;
  const state = readState();
  if (state.mode !== 'prod') return null;
  try {
    if (!state.dev_checkout || fs.realpathSync(state.dev_checkout) !== fs.realpathSync(CHECKOUT_ROOT)) return null;
  } catch { return null; }
  const prod = state.prod_package && packageAt(state.prod_package);
  if (!prod) throw new Error('Saved npm installation is missing. Run lanes dev to repair the installation.');
  if (prod.name === LEGACY_PACKAGE_NAME) {
    throw new Error('The saved Clips release cannot safely use Lanes stores. Run lanes dev or install @dfosco/lanes before using production mode.');
  }
  const result = spawnSync(process.execPath, [path.join(prod.root, 'src', 'cli.js'), ...argv], { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
