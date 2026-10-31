import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { refreshManagedSkill, recordSkillInstallations } from './installation.js';

const devCli = path.resolve(process.cwd(), 'src/cli.js');

function fixture({ legacy = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-installation-'));
  const project = path.join(root, 'project');
  const globalRoot = path.join(root, 'global', 'lib', 'node_modules');
  const packageName = legacy ? 'clips' : 'lanes';
  const installed = path.join(globalRoot, '@dfosco', packageName);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.join(installed, 'src'), { recursive: true });
  fs.mkdirSync(path.join(installed, '.agents', 'skills', packageName), { recursive: true });
  fs.mkdirSync(bin);
  execFileSync('git', ['init', '--quiet'], { cwd: project });
  fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ name: `@dfosco/${packageName}`, version: '1.3.2', type: 'module' }));
  fs.writeFileSync(path.join(installed, '.agents', 'skills', packageName, 'SKILL.md'), 'prod skill 1.3.2\n');
  fs.writeFileSync(path.join(installed, 'src', 'cli.js'), `import fs from 'node:fs';
import path from 'node:path';
const command = process.argv[2];
if (command === 'init') {
  const target = path.join(process.cwd(), '.agents', 'skills', '${packageName}');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), 'prod skill 1.3.2\\n');
} else if (command === '--version') console.log('${packageName} v1.3.2');
else console.log('prod:' + process.argv.slice(2).join(' '));
`);
  fs.writeFileSync(path.join(bin, 'npm'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const globalPath = path.join(process.env.FAKE_GLOBAL_ROOT, '@dfosco', 'lanes');
fs.appendFileSync(process.env.FAKE_NPM_LOG, process.argv.slice(2).join(' ') + '\\n');
if (process.argv[2] === 'root' && process.argv[3] === '-g') console.log(process.env.FAKE_GLOBAL_ROOT);
else if (process.argv[2] === 'link') {
  fs.rmSync(globalPath, { recursive: true, force: true });
  fs.symlinkSync(process.cwd(), globalPath, 'dir');
} else process.exit(2);
`);
  fs.chmodSync(path.join(bin, 'npm'), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    LANES_HOME: '',
    CLIPS_HOME: path.join(root, 'home'),
    FAKE_GLOBAL_ROOT: globalRoot,
    FAKE_NPM_LOG: path.join(root, 'npm.log'),
  };
  return { root, project, globalRoot, env };
}

describe('local installation switching', () => {
  it('refreshes proven unchanged copies but preserves modified and unmanaged files', () => {
    const { root, project, env } = fixture();
    try {
      vi.stubEnv('LANES_HOME', env.CLIPS_HOME);
      const source = path.join(root, 'source');
      const target = path.join(project, '.agents', 'skills', 'lanes');
      fs.mkdirSync(source);
      fs.writeFileSync(path.join(source, 'SKILL.md'), 'version one');
      const first = refreshManagedSkill(source, target);
      recordSkillInstallations({ [target]: { files: first.files } });
      fs.writeFileSync(path.join(source, 'SKILL.md'), 'version two');
      const second = refreshManagedSkill(source, target);
      expect(second.updated).toBe(true);
      expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('version two');
      recordSkillInstallations({ [target]: { files: second.files } });
      fs.writeFileSync(path.join(target, 'SKILL.md'), 'local edit');
      fs.writeFileSync(path.join(target, 'notes.md'), 'local note');
      fs.writeFileSync(path.join(source, 'SKILL.md'), 'version three');
      fs.writeFileSync(path.join(source, 'notes.md'), 'new packaged note');
      expect(refreshManagedSkill(source, target).updated).toBe(false);
      expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('local edit');
      expect(fs.readFileSync(path.join(target, 'notes.md'), 'utf8')).toBe('local note');
    } finally { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('retains the npm package offline, routes prod commands, and refreshes skills in both modes', () => {
    const { root, project, globalRoot, env } = fixture();
    try {
      execFileSync(process.execPath, [devCli, 'dev', '--project', project], { cwd: root, env });
      const statePath = path.join(env.CLIPS_HOME, 'installation.json');
      let state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      expect(state.mode).toBe('dev');
      expect(fs.realpathSync(path.join(globalRoot, '@dfosco', 'lanes'))).toBe(path.resolve(process.cwd()));
      expect(fs.readFileSync(path.join(project, '.agents', 'skills', 'lanes', 'SKILL.md'), 'utf8')).toBe(fs.readFileSync(path.resolve('.agents/skills/lanes/SKILL.md'), 'utf8'));
      expect(fs.readdirSync(path.join(project, '.agents', 'skills'))).toEqual(['lane-dev', 'lane-manager', 'lane-plugin', 'lane-radar', 'lanes']);
      expect(fs.existsSync(path.join(state.prod_package, 'src', 'cli.js'))).toBe(true);

      execFileSync(process.execPath, [devCli, 'prod'], { cwd: project, env });
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      expect(state.mode).toBe('prod');
      expect(fs.readFileSync(path.join(project, '.agents', 'skills', 'lanes', 'SKILL.md'), 'utf8')).toBe('prod skill 1.3.2\n');
      expect(fs.existsSync(path.join(project, '.agents', 'skills', 'loopz'))).toBe(false);
      expect(fs.existsSync(path.join(project, '.agents', 'skills', 'lane-dev'))).toBe(false);
      expect(fs.existsSync(path.join(project, '.agents', 'skills', 'lane-radar'))).toBe(false);
      expect(fs.existsSync(path.join(project, '.agents', 'skills', 'lane-plugin'))).toBe(false);
      expect(fs.existsSync(path.join(project, '.agents', 'skills', 'lane-manager'))).toBe(false);
      expect(fs.existsSync(path.join(project, '.agents', 'skills', 'clips-frame-goal', 'SKILL.md'))).toBe(false);
      expect(execFileSync(process.execPath, [devCli, '--version'], { cwd: project, env, encoding: 'utf8' }).trim()).toBe('lanes v1.3.2');

      execFileSync(process.execPath, [devCli, 'dev'], { cwd: project, env });
      expect(JSON.parse(fs.readFileSync(statePath, 'utf8')).mode).toBe('dev');
      expect(fs.readFileSync(path.join(project, '.agents', 'skills', 'lanes', 'SKILL.md'), 'utf8')).toBe(fs.readFileSync(path.resolve('.agents/skills/lanes/SKILL.md'), 'utf8'));
      expect(fs.readdirSync(path.join(project, '.agents', 'skills'))).toEqual(['lane-dev', 'lane-manager', 'lane-plugin', 'lane-radar', 'lanes']);
      expect(fs.readFileSync(env.FAKE_NPM_LOG, 'utf8').trim().split('\n')).toEqual(['root -g', 'link', 'root -g', 'root -g']);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 15000);

  it('fails before linking when no local npm installation can be saved', () => {
    const { root, project, globalRoot, env } = fixture();
    try {
      fs.rmSync(path.join(globalRoot, '@dfosco', 'lanes'), { recursive: true });
      const result = spawnSync(process.execPath, [devCli, 'dev'], { cwd: project, env, encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('No locally installed npm package');
      expect(fs.existsSync(path.join(env.CLIPS_HOME, 'installation.json'))).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('falls back from a stale saved checkout path to this valid checkout', () => {
    const { root, project, env } = fixture();
    const statePath = path.join(env.CLIPS_HOME, 'installation.json');
    try {
      fs.mkdirSync(env.CLIPS_HOME, { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify({ mode: 'prod', dev_checkout: path.join(root, 'workspace', 'clips') }));
      execFileSync(process.execPath, [devCli, 'dev', '--project', project], { cwd: root, env });
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      expect(state.mode).toBe('dev');
      expect(state.dev_checkout).toBe(fs.realpathSync(process.cwd()));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 15_000);

  it('preserves legacy packages but refuses unsafe prod activation and dispatch', () => {
    const { root, project, env } = fixture({ legacy: true });
    try {
      execFileSync(process.execPath, [devCli, 'dev', '--project', project], { cwd: root, env });
      const stateFile = path.join(env.CLIPS_HOME, 'installation.json');
      const state = JSON.parse(fs.readFileSync(stateFile));
      expect(JSON.parse(fs.readFileSync(path.join(state.prod_package, 'package.json'))).name).toBe('@dfosco/clips');
      const before = fs.readFileSync(stateFile, 'utf8');
      const activate = spawnSync(process.execPath, [devCli, 'prod'], { cwd: project, env, encoding: 'utf8' });
      expect(activate.status).toBe(1);
      expect(activate.stderr).toContain('Install @dfosco/lanes');
      expect(fs.readFileSync(stateFile, 'utf8')).toBe(before);
      fs.writeFileSync(stateFile, JSON.stringify({ ...state, mode: 'prod' }));
      const dispatch = spawnSync(process.execPath, [devCli, '--version'], { cwd: project, env, encoding: 'utf8' });
      expect(dispatch.status).toBe(1);
      expect(dispatch.stderr).toContain('cannot safely use Lanes stores');
      const paths = JSON.parse(execFileSync(process.execPath, [devCli, 'paths', '--json'], { cwd: project, env, encoding: 'utf8' }));
      expect(paths.storeDir).toBe(path.join(fs.realpathSync(project), '.lanes'));
      execFileSync(process.execPath, [devCli, 'init', '--store-only'], { cwd: project, env });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('saves canonical packages separately from old releases with the same version', () => {
    const { root, project, env } = fixture();
    try {
      const legacy = path.join(env.CLIPS_HOME, 'installations', 'prod', '1.3.2');
      fs.mkdirSync(path.join(legacy, 'src'), { recursive: true });
      fs.writeFileSync(path.join(legacy, 'package.json'), JSON.stringify({ name: '@dfosco/clips', version: '1.3.2' }));
      fs.writeFileSync(path.join(legacy, 'src', 'cli.js'), '// preserved old release');
      execFileSync(process.execPath, [devCli, 'dev', '--project', project], { cwd: root, env });
      const state = JSON.parse(fs.readFileSync(path.join(env.CLIPS_HOME, 'installation.json')));
      expect(state.prod_package).not.toBe(legacy);
      expect(JSON.parse(fs.readFileSync(path.join(state.prod_package, 'package.json'))).name).toBe('@dfosco/lanes');
      expect(fs.readFileSync(path.join(legacy, 'src', 'cli.js'), 'utf8')).toBe('// preserved old release');
      execFileSync(process.execPath, [devCli, 'prod'], { cwd: project, env });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it.each(['dev', 'prod'])('migrates a default legacy home before %s selects or saves package state', mode => {
    const { root, project, globalRoot, env: original } = fixture();
    const home = path.join(root, 'user');
    const env = { ...original, HOME: home, CLIPS_HOME: '', LANES_HOME: '' };
    const oldHome = path.join(home, '.clips');
    const oldPackage = path.join(oldHome, 'installations', 'prod', '1.3.2');
    try {
      fs.mkdirSync(path.dirname(oldPackage), { recursive: true });
      fs.cpSync(path.join(globalRoot, '@dfosco', 'lanes'), oldPackage, { recursive: true });
      fs.writeFileSync(path.join(oldHome, 'installation.json'), JSON.stringify({
        mode: 'dev', dev_checkout: process.cwd(), prod_package: oldPackage, custom: 'keep',
      }));
      execFileSync(process.execPath, [devCli, mode, '--project', project], { cwd: root, env });
      const stateFile = path.join(home, '.lanes', 'installation.json');
      const state = JSON.parse(fs.readFileSync(stateFile));
      expect(state.mode).toBe(mode);
      expect(state.custom).toBe('keep');
      expect(state.prod_package).toContain(`${path.sep}.lanes${path.sep}`);
      expect(fs.existsSync(path.join(state.prod_package, 'src', 'cli.js'))).toBe(true);
      expect(fs.existsSync(oldHome)).toBe(false);
      expect(JSON.parse(fs.readFileSync(path.join(home, '.lanes', 'installations', 'prod', '1.3.2', 'package.json'))).name).toBe('@dfosco/lanes');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
