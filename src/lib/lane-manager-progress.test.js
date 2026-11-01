import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const skill = fs.readFileSync(path.resolve('.agents/skills/lane-manager/SKILL.md'), 'utf8');
const paseo = fs.readFileSync(path.resolve('.agents/skills/lanes/references/paseo.md'), 'utf8');
const text = (value) => value.replace(/\s+/g, ' ');

function section(heading) {
  const start = skill.indexOf(`## ${heading}\n`);
  expect(start).toBeGreaterThanOrEqual(0);
  return text(skill.slice(start).split(/\n## /)[0]);
}

describe('Lane Manager progress communication contract', () => {
  const body = section('Keep the user informed like a project manager');

  it('covers each milestone', () => {
    for (const term of ['initial understanding', 'delivery mode', 'breakdown', 'write boundary',
      'dependencies', 'launches', 'handoff', 'fold', 'failure', 'uncertainty', 'next step',
      'user decision']) {
      expect(body.toLowerCase()).toContain(term);
    }
  });

  it('forbids noise and preserves autonomy', () => {
    expect(body).toContain('percentages');
    expect(body).toContain('raw logs');
    expect(body).toContain('chain-of-thought');
    expect(body).toContain('routine "go"');
  });

  it('stays host-agnostic with Paseo only supplemental', () => {
    expect(body).toContain('every host');
    expect(body).not.toMatch(/paseo plugin|AGENTS\.md required/i);
  });

  it('documents the shipped plugin role routing contract', () => {
    expect(text(paseo)).toContain('A role contains optional instructions and skill references.');
    expect(text(paseo)).toContain('Ranked automatic routes use the shared provider handoff threshold');
    expect(text(paseo)).toContain('A manual provider/model selection is an explicit override');
    expect(text(paseo)).toContain('the plugin sends `/lane-manager Proceed as the lane manager`');
    expect(text(paseo)).toContain('Native Paseo profiles are not a required input');
  });
});
