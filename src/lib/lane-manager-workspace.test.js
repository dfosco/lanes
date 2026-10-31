import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const skill = fs.readFileSync(path.resolve('.agents/skills/lane-manager/SKILL.md'), 'utf8');

function section(heading) {
  const match = new RegExp(`^(#{2,3}) ${heading}\\n`, 'm').exec(skill);
  expect(match, `Missing section: ${heading}`).not.toBeNull();
  return skill.slice(match.index).split(new RegExp(`\\n#{1,${match[1].length}} `))[0].replace(/\s+/g, ' ');
}

describe('Lane Manager workspace boundary contract', () => {
  const boundary = section('Keep work within the current workspace by default');

  it('defaults work, inspection, dispatch and communication to the observed workspace', () => {
    expect(boundary).toContain('Unless the user explicitly directs a cross-workspace action');
    expect(boundary).toContain('within the current host-observed workspace and repository');
    expect(boundary).toContain('actual host readback');
    expect(boundary).toContain('Do not message agents in other workspaces');
    expect(boundary).toContain('route or defer work across workspace boundaries');
    expect(boundary).toContain('inspect or mutate unrelated workspace state');
  });

  it('preserves same-workspace coordination and limits exceptions to user direction', () => {
    expect(boundary).toContain('Same-workspace coordination and handoffs remain allowed');
    expect(boundary).toContain('permits only the actions the user explicitly directs');
  });

  it('retains central Lanes discovery and does not authorize adopting other managers work', () => {
    expect(boundary).toContain('does not skip the required central Lanes discovery');
    expect(boundary).toContain('canonical records for Lanes this manager actually manages');
    expect(boundary).toContain('listing them is not permission to adopt their work');
    expect(section('Start with central discovery every time'))
      .toContain('lanes lane manager list --all --json');
  });

  it('remains host-agnostic rather than prescribing one host integration', () => {
    expect(boundary).not.toMatch(/Paseo|Copilot|OpenCode/);
  });
});
