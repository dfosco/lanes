import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { readBoardData } from './board.js';

const cliPath = path.resolve(process.cwd(), 'src', 'cli.js');
const roots = [];

function workspace({ collaboration = false, tasksAsIssues = false, remote = 'https://github.com/acme/app.git', fakeGh = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-collaboration-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: root });
  const db = path.join(root, '.clips', 'db');
  fs.mkdirSync(path.join(db, 'tracks'), { recursive: true });
  fs.mkdirSync(path.join(root, '.clips', 'records', 'cr'), { recursive: true });
  fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), JSON.stringify({
    collaboration,
    tasks_as_issues: tasksAsIssues,
    feature_flag: 'preserve-me',
  }) + '\n');
  const env = {
    ...process.env,
    HOME: path.join(root, 'home'),
    LANES_HOME: path.join(root, 'home', '.lanes'),
    CLIPS_HOME: path.join(root, 'home', '.clips'),
    GH_LOG: path.join(root, 'gh.log'),
    GH_BODY_LOG: path.join(root, 'gh-body.md'),
  };
  fs.mkdirSync(env.HOME, { recursive: true });
  if (fakeGh) {
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
printf '%s\\n' "$*" >> "$GH_LOG"
if [ "$1" = "issue" ] || [ "$1" = "pr" ]; then
  case "$*" in *"--repo acme/app"*) ;; *) echo "unexpected GitHub repository target: $*" >&2; exit 1;; esac
  if [ "$GH_REPO" != "acme/app" ]; then echo "unexpected GH_REPO: $GH_REPO" >&2; exit 1; fi
fi
if [ "$1" = "issue" ] && [ "$2" = "list" ]; then
  if [ "$GH_AUTH_FAIL" = "1" ]; then echo "HTTP 401: Bad credentials" >&2; exit 1; fi
  printf '%s\\n' "\${GH_ISSUES:-[]}"
  exit 0
fi
if [ "$1" = "api" ] && [ "$2" = "--paginate" ]; then
  printf '%s\\n' "\${GH_REMOTE_ISSUES:-[]}"
  exit 0
fi
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  case "$*" in *repository*) echo "unknown JSON field: repository" >&2; exit 1;; esac
  printf '[]\\n'; exit 0
fi
if [ "$1" = "issue" ] && [ "$2" = "create" ]; then
  case "$*" in *Lane*) number=100;; *Task*) number=201;; *) number=200;; esac
  case "$*" in
    *Task*) if [ "$GH_FAIL_TASK" = "1" ]; then echo "HTTP 403: Resource not accessible by integration" >&2; exit 1; fi;;
  esac
  printf '\\n--- body ---\\n' >> "$GH_BODY_LOG"
  cat >> "$GH_BODY_LOG"
  if [ "$GH_CREATE_AMBIGUOUS" = "1" ]; then
    echo "HTTP 502: response interrupted after request" >&2
    exit 1
  fi
  printf 'https://github.com/acme/app/issues/%s\\n' "$number"
  exit 0
fi
if [ "$1" = "api" ]; then
  case "$*" in
    *sub_issues*)
      if [ "$GH_SUBISSUES_UNSUPPORTED" = "1" ] && [ "$2" = "-X" ] && [ "$3" = "POST" ]; then
        echo "HTTP 404: Sub-issues are not supported for this repository" >&2; exit 1
      fi
      printf '{}\\n'; exit 0;;
    */parent)
      if [ -n "$GH_PARENT" ]; then printf '{"number":%s,"id":999,"html_url":"https://github.com/acme/app/issues/%s"}\\n' "$GH_PARENT" "$GH_PARENT"; else echo "HTTP 404: Not Found" >&2; exit 1; fi;;
    *)
      printf '{"id":999,"state":"open"}\\n'; exit 0;;
  esac
fi
if [ "$1" = "issue" ] && [ "$2" = "edit" ]; then
  printf '\\n--- body ---\\n' >> "$GH_BODY_LOG"
  cat >> "$GH_BODY_LOG"
fi
exit 0
`);
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    env.PATH = `${bin}:${process.env.PATH}`;
  }
  return { root, db, env };
}

function run(root, env, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: root, env, encoding: 'utf8' });
}

function seedGoal(db, { id = 'g001', title = 'Goal', trackId = null, attachments = [], tasks = [], issueEvent = null } = {}) {
  const events = [
    { event: 'goal_created', goal_id: id, title, status: 'open', ...(trackId ? { track_id: trackId } : {}) },
    ...(issueEvent ? [issueEvent] : []),
    ...attachments.map((attachment) => ({ event: 'attachment_added', goal_id: id, attachment })),
    ...tasks.flatMap((task) => [
      { event: 'task_created', goal_id: id, task_id: task.id, title: task.title, status: task.status || 'open' },
      ...(task.issueEvent ? [task.issueEvent] : []),
    ]),
  ];
  fs.writeFileSync(path.join(db, `${id}.jsonl`), `${events.map(JSON.stringify).join('\n')}\n`);
}

function seedLane(db, { id = 'r001', title = 'Lane', issueNumber = null } = {}) {
  const laneId = `l${id.slice(1)}`;
  const events = [
    { event: 'lane_created', lane_id: laneId, track_id: id, title, description: '', status: 'open' },
    ...(issueNumber ? [{
      event: 'lane_github_synced',
      lane_id: laneId,
      issue_number: issueNumber,
      issue_url: `https://github.com/acme/app/issues/${issueNumber}`,
      repository: 'acme/app',
      remote_host: 'github.com',
    }] : []),
  ];
  fs.writeFileSync(path.join(db, 'tracks', `${id}.jsonl`), `${events.map(JSON.stringify).join('\n')}\n`);
}

function board(root, db) {
  return readBoardData({
    dbDir: db,
    recordsDir: path.join(root, '.clips', 'records', 'cr'),
    componentsDir: path.join(root, '.clips', 'components'),
    projectPath: root,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('explicit collaboration lifecycle', () => {
  it('keeps sync off fully local and exposes project control, status, and preview commands', () => {
    const { root, db, env } = workspace();
    const planPath = path.join(root, 'plan.md');
    fs.writeFileSync(planPath, '# Existing plan\n');
    seedGoal(db, {
      issueEvent: { event: 'github_synced', goal_id: 'g001', issue_number: 7, issue_url: 'https://github.com/acme/app/issues/7' },
      attachments: [{
        id: 'att-00000000-0000-4000-8000-000000000001',
        type: 'markdown',
        title: 'Plan',
        path: planPath,
      }],
    });
    fs.writeFileSync(path.join(db, '_github.jsonl'), '{"event":"cache-entry","keep":true}\n');
    const recordPath = path.join(db, 'g001.jsonl');
    const recordBefore = fs.readFileSync(recordPath, 'utf8');
    const cacheBefore = fs.readFileSync(path.join(db, '_github.jsonl'), 'utf8');
    const planBefore = fs.readFileSync(planPath, 'utf8');

    for (const args of [
      ['sync'],
      ['sync', '#g1'],
      ['sync', 'status', '--json'],
      ['sync', 'preview', '--json'],
      ['config', 'collaboration', 'true'],
      ['config', 'collaboration', 'false'],
      ['sync', '#g1'],
    ]) {
      const result = run(root, env, ...args);
      expect(result.status, result.stderr).toBe(0);
    }
    expect(fs.existsSync(env.GH_LOG)).toBe(false);
    expect(fs.readFileSync(recordPath, 'utf8')).toBe(recordBefore);
    expect(fs.readFileSync(path.join(db, '_github.jsonl'), 'utf8')).toBe(cacheBefore);
    expect(fs.readFileSync(planPath, 'utf8')).toBe(planBefore);
    expect(JSON.parse(fs.readFileSync(path.join(root, '.clips', 'clips.config.json'), 'utf8'))).toMatchObject({
      collaboration: false,
      feature_flag: 'preserve-me',
    });

    const status = JSON.parse(run(root, env, 'sync', 'status', '--json').stdout);
    expect(status).toMatchObject({
      enabled: false,
      state: 'disabled',
      scope: 'project',
      remote_state: 'unknown',
      network_access: 'disabled',
      authentication: 'not_checked',
      hierarchy_capability: 'unknown_until_explicit_sync',
      control: { command: 'lanes config collaboration true|false', network_access: false },
      status: { command: 'lanes sync status --json', network_access: false },
      preview: { command: 'lanes sync preview [record-ref] --json', network_access: false },
      sync: { command: 'lanes sync [record-ref]', network_access: false, requires_explicit_action: true },
    });
    const preview = JSON.parse(run(root, env, 'sync', 'preview', '--json').stdout);
    expect(preview).toMatchObject({
      mode: 'preview',
      collaboration_enabled: false,
      network_accessed: false,
      remote_state: 'unknown',
      authentication: 'unknown_until_explicit_sync',
      hierarchy_capability: 'unknown_until_explicit_sync',
      planned_writes: [],
    });
    expect(board(root, db).collaboration).toMatchObject({ enabled: false, scope: 'project', state: 'disabled' });

    expect(run(root, env, 'config', 'collaboration', 'true').status).toBe(0);
    expect(JSON.parse(run(root, env, 'sync', 'status', '--json').stdout).enabled).toBe(true);
    expect(JSON.parse(run(root, env, 'sync', 'status', '--json').stdout)).toMatchObject({
      network_access: 'explicit_sync_and_mutations',
      automatic_mutation_sync: true,
      mutations: {
        network_access: true,
        trigger: 'goal_task_lane_track_mutations_when_enabled',
      },
    });
    const enabledPreview = run(root, env, 'sync', 'preview', '#g1', '--json');
    expect(enabledPreview.status, enabledPreview.stderr).toBe(0);
    expect(JSON.parse(enabledPreview.stdout).network_accessed).toBe(false);
    expect(fs.existsSync(env.GH_LOG)).toBe(false);
  });

  it('reports missing gh and authentication failures without success-shaped sync output', () => {
    const noGh = workspace({ collaboration: true, fakeGh: false });
    const gitPath = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const bin = path.join(noGh.root, 'bin');
    fs.mkdirSync(bin);
    fs.symlinkSync(gitPath, path.join(bin, 'git'));
    noGh.env.PATH = bin;
    const missing = run(noGh.root, noGh.env, 'sync');
    expect(missing.status).not.toBe(0);
    expect(`${missing.stdout}\n${missing.stderr}`).toContain('gh');
    expect(missing.stdout).not.toContain('Sync complete');

    const auth = workspace({ collaboration: true });
    const failed = run(auth.root, { ...auth.env, GH_AUTH_FAIL: '1' }, 'sync');
    expect(failed.status).not.toBe(0);
    expect(`${failed.stdout}\n${failed.stderr}`).toContain('HTTP 401: Bad credentials');
    expect(failed.stdout).toContain('Remote calls:');
    expect(failed.stdout).not.toContain('Sync complete');
  });

  it('clears a create intent when gh cannot start and allows a later retry', () => {
    const { root, db, env } = workspace({ collaboration: true });
    seedGoal(db);
    const bin = path.join(root, 'no-gh-bin');
    fs.mkdirSync(bin);
    fs.symlinkSync(execFileSync('which', ['git'], { encoding: 'utf8' }).trim(), path.join(bin, 'git'));

    const first = run(root, { ...env, PATH: bin }, 'sync', '#g1');
    expect(first.status).not.toBe(0);
    const journal = fs.readFileSync(path.join(db, 'g001.jsonl'), 'utf8');
    expect(journal).toContain('"event":"github_create_pending"');
    expect(journal).toContain('"event":"github_create_cancelled"');
    expect(fs.existsSync(env.GH_LOG)).toBe(false);

    const retry = run(root, env, 'sync', '#g1');
    expect(retry.status, `${retry.stdout}\n${retry.stderr}`).toBe(0);
    expect(fs.readFileSync(env.GH_LOG, 'utf8').match(/issue create --title \[Goal\] Goal/g)).toHaveLength(1);
    expect(JSON.parse(run(root, env, 'goal', 'show', 'g1').stdout).github_create_pending).toBeUndefined();
  });

  it('overrides inherited GH_REPO and explicitly targets the verified repository', () => {
    const { root, db, env } = workspace({ collaboration: true });
    seedGoal(db);
    const result = run(root, { ...env, GH_REPO: 'attacker/redirect' }, 'sync', '#g1');

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    const calls = fs.readFileSync(env.GH_LOG, 'utf8');
    expect(calls).toContain('issue list --state all');
    expect(calls).toContain('--repo acme/app');
    expect(calls).not.toContain('attacker/redirect');
  });

  it('creates issues in each repository origin, never the plugin repository', () => {
    for (const name of ['one', 'two']) {
      const { root, db, env } = workspace({ collaboration: true, remote: `https://github.com/example/${name}.git`, fakeGh: false });
      const bin = path.join(root, 'bin');
      fs.mkdirSync(bin);
      fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
printf '%s | %s\n' "$GH_REPO" "$*" >> "$GH_LOG"
if [ "$GH_REPO" != "example/${name}" ]; then exit 1; fi
if [ "$1" = "issue" ] && [ "$2" = "create" ]; then
  cat >/dev/null
  printf 'https://github.com/example/${name}/issues/200\n'
elif [ "$1" = "api" ]; then
  case "$*" in
    */parent) echo 'HTTP 404: Not Found' >&2; exit 1;;
    *) printf '{"id":999,"state":"open"}\n';;
  esac
else
  printf '[]\n'
fi
`);
      fs.chmodSync(path.join(bin, 'gh'), 0o755);
      env.PATH = `${bin}:${process.env.PATH}`;
      seedGoal(db);
      const result = run(root, { ...env, GH_REPO: 'dfosco/lanes' }, 'sync', '#g1');
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      const calls = fs.readFileSync(env.GH_LOG, 'utf8');
      expect(calls).toContain(`example/${name} | issue create`);
      expect(calls).toContain(`--repo example/${name}`);
      expect(calls).not.toContain('dfosco/lanes');
      expect(fs.readFileSync(path.join(db, 'g001.jsonl'), 'utf8')).toContain(`https://github.com/example/${name}/issues/200`);
    }
  });

  it('does not adopt a typed issue attachment as a managed Goal during import', () => {
    const attachedIssue = {
      id: 'att-00000000-0000-4000-8000-000000000002',
      type: 'github_issue',
      title: 'External issue',
      url: 'https://github.com/acme/app/issues/77',
      host: 'github.com',
      repository: 'acme/app',
      number: 77,
    };
    const { root, db, env } = workspace({ collaboration: true });
    seedGoal(db, { attachments: [attachedIssue] });
    const imported = JSON.stringify([{
      number: 77,
      title: 'External issue',
      body: 'This remains an external reference.',
      state: 'OPEN',
      url: attachedIssue.url,
      createdAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
    }]);
    const result = run(root, { ...env, GH_ISSUES: imported }, 'sync');
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(fs.existsSync(path.join(db, 'g002.jsonl'))).toBe(false);
    expect(fs.readFileSync(path.join(db, 'g001.jsonl'), 'utf8')).toContain('"issue_number":200');
    expect(fs.readFileSync(env.GH_LOG, 'utf8')).not.toContain('issue edit 77');
  });

  it('fences a managed mapping to its recorded GitHub host and repository', () => {
    const mismatches = [
      {
        issue_url: 'https://git.example.test/acme/app/issues/7',
        repository: 'acme/app',
        remote_host: 'git.example.test',
      },
      {
        issue_url: 'https://github.com/other/repo/issues/7',
        repository: 'other/repo',
        remote_host: 'github.com',
      },
    ];
    for (const mapping of mismatches) {
      const external = workspace({ collaboration: true });
      seedGoal(external.db, {
        issueEvent: { event: 'github_synced', goal_id: 'g001', issue_number: 7, ...mapping },
      });
      const evalCode = `import { pushGoal } from ${JSON.stringify(pathToFileURL(path.resolve(process.cwd(), 'src/lib/sync.js')).href)}; pushGoal('g001');`;
      const result = spawnSync(process.execPath, ['--input-type=module', '--eval', evalCode], {
        cwd: external.root, env: external.env, encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('different GitHub host or repository');
      expect(fs.existsSync(external.env.GH_LOG)).toBe(false);
    }
  });

  it('keeps malformed collaboration state explicit and blocks sync before network access', () => {
    const { root, env } = workspace();
    const configPath = path.join(root, '.clips', 'clips.config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.collaboration = 'true';
    fs.writeFileSync(configPath, `${JSON.stringify(config)}\n`);

    const status = run(root, env, 'sync', 'status', '--json');
    expect(status.status).not.toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      enabled: null,
      state: 'invalid',
      remote_state: 'unknown',
      authentication: 'not_checked',
      hierarchy_capability: 'unknown_until_explicit_sync',
    });
    const sync = run(root, env, 'sync');
    expect(sync.status).not.toBe(0);
    expect(`${sync.stdout}\n${sync.stderr}`).toContain('collaboration configuration must be a boolean');
    expect(fs.existsSync(env.GH_LOG)).toBe(false);
  });

  it('does not report sync success when a pull response is malformed', () => {
    const { root, env } = workspace({ collaboration: true });
    const result = run(root, { ...env, GH_ISSUES: '{not-json' }, 'sync');
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('Sync complete');
    expect(`${result.stdout}\n${result.stderr}`).toContain('JSON at position');
  });

  it('reports partial issue creation failures, retains successful mappings, and retries without duplicates', () => {
    const { root, db, env } = workspace({ collaboration: true, tasksAsIssues: true });
    seedGoal(db, { tasks: [{ id: 't01', title: 'Task title' }] });

    const first = run(root, { ...env, GH_FAIL_TASK: '1' }, 'sync', '#g1');
    expect(first.status).not.toBe(0);
    expect(`${first.stdout}\n${first.stderr}`).toContain('create.task #g001#t01');
    expect(first.stdout).not.toContain('✅ Synced');
    const firstGoal = JSON.parse(run(root, env, 'goal', 'show', 'g1').stdout);
    expect(firstGoal.issue_number).toBe(200);
    expect(firstGoal.tasks[0].issue_number).toBeUndefined();

    const second = run(root, env, 'sync', '#g1');
    expect(second.status).toBe(0);
    const finalGoal = JSON.parse(run(root, env, 'goal', 'show', 'g1').stdout);
    expect(finalGoal.issue_number).toBe(200);
    expect(finalGoal.tasks[0].issue_number).toBe(201);
    const calls = fs.readFileSync(env.GH_LOG, 'utf8');
    expect(calls.match(/issue create --title \[Goal\] Goal/g)).toHaveLength(1);
    expect(calls.match(/issue create --title Task title/g)).toHaveLength(2);
    expect(fs.readFileSync(env.GH_BODY_LOG, 'utf8')).toContain('[Task title](https://github.com/acme/app/issues/201) `#g001#t01`');
  });

  it('reconciles an ambiguous Goal create by its stable marker and never creates again while unresolved', () => {
    const { root, db, env } = workspace({ collaboration: true });
    seedGoal(db);

    const first = run(root, { ...env, GH_CREATE_AMBIGUOUS: '1' }, 'sync', '#g1');
    expect(first.status).not.toBe(0);
    expect(fs.readFileSync(path.join(db, 'g001.jsonl'), 'utf8')).toContain('"event":"github_create_pending"');
    const marker = fs.readFileSync(env.GH_BODY_LOG, 'utf8').match(/<!-- lanes-sync-goal-[a-f0-9]+ -->/)?.[0];
    expect(marker).toBeTruthy();

    const unresolved = run(root, env, 'sync', '#g1');
    expect(unresolved.status).not.toBe(0);
    expect(`${unresolved.stdout}\n${unresolved.stderr}`).toContain('Refusing to create a duplicate');
    expect(fs.readFileSync(env.GH_LOG, 'utf8').match(/issue create --title \[Goal\] Goal/g)).toHaveLength(1);

    fs.appendFileSync(path.join(db, 'g001.jsonl'), `${JSON.stringify({
      event: 'updated', goal_id: 'g001', title: 'Goal revised', description: 'Current local Goal body',
    })}\n`);
    const remoteIssue = JSON.stringify([{
      number: 200,
      title: '[Goal] Goal',
      body: marker,
      state: 'OPEN',
      html_url: 'https://github.com/acme/app/issues/200',
      url: 'https://github.com/acme/app/issues/200',
      createdAt: '2026-10-01T00:00:00Z',
    }]);
    const recovered = run(root, { ...env, GH_ISSUES: remoteIssue, GH_REMOTE_ISSUES: remoteIssue }, 'sync', '#g1');
    expect(recovered.status).toBe(0);
    expect(fs.existsSync(path.join(db, 'g002.jsonl'))).toBe(false);
    expect(JSON.parse(run(root, env, 'goal', 'show', 'g1').stdout)).toMatchObject({
      issue_number: 200,
      issue_url: 'https://github.com/acme/app/issues/200',
      title: 'Goal revised',
    });
    expect(fs.readFileSync(env.GH_LOG, 'utf8')).toContain('issue edit 200 --title [Goal] Goal revised');
    expect(fs.readFileSync(env.GH_BODY_LOG, 'utf8')).toContain('Current local Goal body');
    expect(fs.readFileSync(env.GH_LOG, 'utf8').match(/issue create --title \[Goal\] Goal/g)).toHaveLength(1);
  });

  it('recovers a remote Goal create when the local mapping append fails', () => {
    const { root, db, env } = workspace({ collaboration: true });
    seedGoal(db);
    const moduleUrl = pathToFileURL(path.resolve(process.cwd(), 'src/lib/sync.js')).href;
    const evalCode = `
      import fs from 'node:fs';
      const appendFileSync = fs.appendFileSync;
      fs.appendFileSync = function (file, data, ...args) {
        if (String(data).includes('"event":"github_synced"')) throw new Error('fixture mapping append failure');
        return appendFileSync.call(fs, file, data, ...args);
      };
      const { pushGoal } = await import(${JSON.stringify(moduleUrl)});
      pushGoal('g001');
    `;
    const first = spawnSync(process.execPath, ['--input-type=module', '--eval', evalCode], {
      cwd: root, env, encoding: 'utf8',
    });
    expect(first.status).not.toBe(0);
    expect(first.stderr).toContain('fixture mapping append failure');
    expect(fs.readFileSync(path.join(db, 'g001.jsonl'), 'utf8')).toContain('"event":"github_create_pending"');
    const marker = fs.readFileSync(env.GH_BODY_LOG, 'utf8').match(/<!-- lanes-sync-goal-[a-f0-9]+ -->/)?.[0];
    const remoteIssue = JSON.stringify([{
      number: 200,
      title: '[Goal] Goal',
      body: marker,
      state: 'OPEN',
      html_url: 'https://github.com/acme/app/issues/200',
      url: 'https://github.com/acme/app/issues/200',
      createdAt: '2026-10-01T00:00:00Z',
    }]);

    const recovered = run(root, { ...env, GH_ISSUES: remoteIssue, GH_REMOTE_ISSUES: remoteIssue }, 'sync', '#g1');
    expect(recovered.status, `${recovered.stdout}\n${recovered.stderr}`).toBe(0);
    expect(fs.readFileSync(env.GH_LOG, 'utf8').match(/issue create --title \[Goal\] Goal/g)).toHaveLength(1);
    expect(JSON.parse(run(root, env, 'goal', 'show', 'g1').stdout).issue_number).toBe(200);
    expect(fs.existsSync(path.join(db, 'g002.jsonl'))).toBe(false);
  });

  it('applies a newly created Task state immediately', () => {
    const { root, db, env } = workspace({ collaboration: true, tasksAsIssues: true });
    seedGoal(db, { tasks: [{ id: 't01', title: 'Closed Task', status: 'closed' }] });

    const result = run(root, env, 'sync', '#g1');
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(fs.readFileSync(env.GH_LOG, 'utf8')).toContain('issue close 201');
  });

  it('reconciles an ambiguous Task create without creating a duplicate', () => {
    const { root, db, env } = workspace({ collaboration: true, tasksAsIssues: true });
    seedGoal(db, {
      issueEvent: { event: 'github_synced', goal_id: 'g001', issue_number: 7, issue_url: 'https://github.com/acme/app/issues/7' },
      tasks: [{ id: 't01', title: 'Task title' }],
    });

    const first = run(root, { ...env, GH_CREATE_AMBIGUOUS: '1' }, 'sync', '#g1');
    expect(first.status).not.toBe(0);
    expect(fs.readFileSync(path.join(db, 'g001.jsonl'), 'utf8')).toContain('"event":"task_github_create_pending"');
    const marker = fs.readFileSync(env.GH_BODY_LOG, 'utf8').match(/<!-- lanes-sync-task-[a-f0-9]+ -->/)?.[0];
    expect(marker).toBeTruthy();
    fs.appendFileSync(path.join(db, 'g001.jsonl'), `${JSON.stringify({
      event: 'task_updated', goal_id: 'g001', task_id: 't01', title: 'Task revised',
    })}\n`);

    const remoteIssue = JSON.stringify([{
      number: 201,
      title: 'Task title',
      body: marker,
      state: 'OPEN',
      html_url: 'https://github.com/acme/app/issues/201',
      url: 'https://github.com/acme/app/issues/201',
      createdAt: '2026-10-01T00:00:00Z',
    }]);
    const recovered = run(root, { ...env, GH_ISSUES: remoteIssue, GH_REMOTE_ISSUES: remoteIssue }, 'sync', '#g1');
    expect(recovered.status, `${recovered.stdout}\n${recovered.stderr}`).toBe(0);
    expect(fs.existsSync(path.join(db, 'g002.jsonl'))).toBe(false);
    expect(JSON.parse(run(root, env, 'goal', 'show', 'g1').stdout).tasks[0].issue_number).toBe(201);
    expect(fs.readFileSync(env.GH_LOG, 'utf8').match(/issue create --title Task title/g)).toHaveLength(1);
    expect(fs.readFileSync(env.GH_LOG, 'utf8')).toContain('issue edit 201 --title Task revised');
    expect(fs.readFileSync(env.GH_BODY_LOG, 'utf8')).toContain('[Task revised]');
  });

  it('reconciles an ambiguous Lane create without creating a duplicate', () => {
    const { root, db, env } = workspace({ collaboration: true });
    fs.writeFileSync(path.join(db, 'tracks', 'r001.jsonl'), `${JSON.stringify({
      event: 'lane_created',
      lane_id: 'l001',
      track_id: 'r001',
      title: 'Lane title',
      description: '',
      status: 'open',
    })}\n`);

    const first = run(root, { ...env, GH_CREATE_AMBIGUOUS: '1' }, 'sync', '#l001');
    expect(first.status).not.toBe(0);
    expect(fs.readFileSync(path.join(db, 'tracks', 'r001.jsonl'), 'utf8')).toContain('"event":"lane_github_create_pending"');
    const marker = fs.readFileSync(env.GH_BODY_LOG, 'utf8').match(/<!-- lanes-sync-lane-[a-f0-9]+ -->/)?.[0];
    expect(marker).toBeTruthy();
    fs.appendFileSync(path.join(db, 'tracks', 'r001.jsonl'), `${JSON.stringify({
      event: 'lane_updated', lane_id: 'l001', title: 'Lane revised', description: 'Current local Lane body',
    })}\n`);

    const remoteIssue = JSON.stringify([{
      number: 100,
      title: '[Lane] Lane title',
      body: marker,
      html_url: 'https://github.com/acme/app/issues/100',
    }]);
    const recovered = run(root, { ...env, GH_REMOTE_ISSUES: remoteIssue }, 'sync', '#l001');
    expect(recovered.status, `${recovered.stdout}\n${recovered.stderr}`).toBe(0);
    expect(JSON.parse(run(root, env, 'lane', 'show', '#l001').stdout).issue_number).toBe(100);
    expect(fs.readFileSync(env.GH_LOG, 'utf8').match(/issue create --title \[Lane\] Lane title/g)).toHaveLength(1);
    expect(fs.readFileSync(env.GH_LOG, 'utf8')).toContain('issue edit 100 --title [Lane] Lane revised');
    expect(fs.readFileSync(env.GH_BODY_LOG, 'utf8')).toContain('Current local Lane body');
  });

  it('surfaces enabled mutation auto-sync failures as structured errors', () => {
    const { root, env } = workspace({ collaboration: true });
    const result = run(root, { ...env, GH_CREATE_AMBIGUOUS: '1' }, 'goal', 'create', JSON.stringify({
      title: 'Locally saved Goal',
      description: 'Local mutation survives remote failure.',
    }));

    expect(result.status).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ success: true, goal_id: 'g001' });
    expect(JSON.parse(result.stderr)).toMatchObject({
      event: 'github_auto_sync',
      ref: '#g001',
      status: 'partial',
      effects: {
        failures: [{ action: 'create.goal #g001', message: expect.stringContaining('HTTP 502') }],
      },
    });
    expect(run(root, env, 'goal', 'show', 'g001').status).toBe(0);
  });

  it('reports successful fallback diagnostics on mutation stderr without changing JSON stdout', () => {
    const { root, db, env } = workspace({ collaboration: true, tasksAsIssues: true });
    seedGoal(db, {
      issueEvent: { event: 'github_synced', goal_id: 'g001', issue_number: 7, issue_url: 'https://github.com/acme/app/issues/7' },
      tasks: [{
        id: 't01',
        title: 'Task',
        issueEvent: {
          event: 'task_github_synced',
          goal_id: 'g001',
          task_id: 't01',
          issue_number: 9,
          issue_url: 'https://github.com/acme/app/issues/9',
        },
      }],
    });
    const result = run(root, { ...env, GH_PARENT: '99' }, 'task', 'status', 'g1', 't1', 'closed');

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ success: true, task_id: 't01', status: 'closed' });
    expect(result.stderr).toContain('Preserved existing external parent #99');
  });

  it('previews and executes Task-to-Goal relationships for a Task-scoped request', () => {
    const { root, db, env } = workspace({ collaboration: true, tasksAsIssues: true });
    seedGoal(db, {
      issueEvent: { event: 'github_synced', goal_id: 'g001', issue_number: 7, issue_url: 'https://github.com/acme/app/issues/7' },
      tasks: [{
        id: 't01',
        title: 'Task',
        issueEvent: {
          event: 'task_github_synced',
          goal_id: 'g001',
          task_id: 't01',
          issue_number: 9,
          issue_url: 'https://github.com/acme/app/issues/9',
        },
      }],
    });

    const preview = run(root, env, 'sync', 'preview', '#g1#t1', '--json');
    expect(preview.status, preview.stderr).toBe(0);
    expect(JSON.parse(preview.stdout).planned_writes).toEqual(expect.arrayContaining([
      {
        kind: 'relationship',
        relation: 'goal_task',
        ref: '#g001#t01',
        parent_ref: '#g001',
        action: 'reconcile_parent_if_supported',
        trigger: 'goal_sync',
      },
    ]));
    const readablePreview = run(root, env, 'sync', 'preview', '#g1#t1');
    expect(readablePreview.stdout).toContain('relationship goal_task #g001#t01 -> #g001');

    const execution = run(root, env, 'sync', '#g1#t1');
    expect(execution.status, `${execution.stdout}\n${execution.stderr}`).toBe(0);
    expect(fs.readFileSync(env.GH_LOG, 'utf8')).toContain('api -X POST repos/acme/app/issues/7/sub_issues');
  });

  it('previews and executes detaching a Goal from its former managed Lane', () => {
    const { root, db, env } = workspace({ collaboration: true });
    seedLane(db, { issueNumber: 100 });
    seedGoal(db, {
      issueEvent: { event: 'github_synced', goal_id: 'g001', issue_number: 7, issue_url: 'https://github.com/acme/app/issues/7' },
    });

    const preview = run(root, env, 'sync', 'preview', '#g1', '--json');
    expect(preview.status, preview.stderr).toBe(0);
    expect(JSON.parse(preview.stdout).planned_writes).toEqual(expect.arrayContaining([
      {
        kind: 'relationship',
        relation: 'lane_goal',
        ref: '#g001',
        parent_ref: null,
        action: 'reconcile_parent_if_supported',
        trigger: 'goal_sync',
      },
    ]));

    const execution = run(root, { ...env, GH_PARENT: '100' }, 'sync', '#g1');
    expect(execution.status, `${execution.stdout}\n${execution.stderr}`).toBe(0);
    expect(fs.readFileSync(env.GH_LOG, 'utf8')).toContain('api -X DELETE repos/acme/app/issues/100/sub_issues');
  });

  it('previews and executes sibling Goal links when a parent Lane is first created', () => {
    const { root, db, env } = workspace({ collaboration: true });
    seedLane(db);
    seedGoal(db, {
      trackId: 'r001',
      issueEvent: { event: 'github_synced', goal_id: 'g001', issue_number: 7, issue_url: 'https://github.com/acme/app/issues/7' },
    });
    seedGoal(db, {
      id: 'g002',
      title: 'Sibling',
      trackId: 'r001',
      issueEvent: { event: 'github_synced', goal_id: 'g002', issue_number: 8, issue_url: 'https://github.com/acme/app/issues/8' },
    });

    const preview = run(root, env, 'sync', 'preview', '#g1', '--json');
    expect(preview.status, preview.stderr).toBe(0);
    expect(JSON.parse(preview.stdout).planned_writes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'relationship',
        relation: 'lane_goal',
        ref: '#g001',
        parent_ref: '#l001',
        trigger: 'parent_lane_creation',
      }),
      expect.objectContaining({
        kind: 'relationship',
        relation: 'lane_goal',
        ref: '#g002',
        parent_ref: '#l001',
        trigger: 'parent_lane_creation',
      }),
    ]));

    const execution = run(root, env, 'sync', '#g1');
    expect(execution.status, `${execution.stdout}\n${execution.stderr}`).toBe(0);
    const parentLinks = fs.readFileSync(env.GH_LOG, 'utf8').match(/api -X POST repos\/acme\/app\/issues\/100\/sub_issues/g) || [];
    expect(parentLinks.length).toBeGreaterThanOrEqual(2);
  });

  it('previews the full Goal push for a valid Task ref and rejects invalid refs before networking', () => {
    const { root, db, env } = workspace({ collaboration: true, tasksAsIssues: true });
    seedGoal(db, { tasks: [{ id: 't01', title: 'First' }, { id: 't02', title: 'Second' }] });

    const preview = run(root, env, 'sync', 'preview', '#g1#t1', '--json');
    expect(preview.status, preview.stderr).toBe(0);
    expect(JSON.parse(preview.stdout)).toMatchObject({
      requested_ref: '#g1#t1',
      execution_scope: 'whole_goal',
    });
    expect(JSON.parse(preview.stdout).planned_writes).toEqual(expect.arrayContaining([
      { kind: 'goal', ref: '#g001', action: 'create_managed_issue' },
      { kind: 'task', ref: '#g001#t01', action: 'create_managed_issue' },
      { kind: 'task', ref: '#g001#t02', action: 'create_managed_issue' },
      expect.objectContaining({ kind: 'relationship', relation: 'goal_task', ref: '#g001#t01', parent_ref: '#g001' }),
      expect.objectContaining({ kind: 'relationship', relation: 'goal_task', ref: '#g001#t02', parent_ref: '#g001' }),
    ]));
    for (const args of [
      ['sync', 'preview', '#g1#t99', '--json'],
      ['sync', 'preview', '#g1#r1', '--json'],
      ['sync', '#g1', 'unexpected'],
      ['sync', '#g1#t99'],
    ]) {
      const invalid = run(root, env, ...args);
      expect(invalid.status).not.toBe(0);
    }
    expect(fs.existsSync(env.GH_LOG)).toBe(false);
  });
});
