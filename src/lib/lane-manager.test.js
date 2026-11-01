import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const skill = fs.readFileSync(path.resolve('.agents/skills/lane-manager/SKILL.md'), 'utf8');
const rule = skill.split('## Complete Goals and route optional human review\n')[1]?.split('\n## ')[0] || '';
const normalizedRule = rule.replace(/\s+/g, ' ');

describe('Lane Manager Goal completion and optional human review contract', () => {
  it('allows verified Goals to close as not-reviewed while preserving explicit review gates', () => {
    expect(normalizedRule).toContain("Goal's implementation is complete");
    expect(normalizedRule).toContain('no human review was requested');
    expect(normalizedRule).toContain('valid Goal acceptance receipt');
    expect(normalizedRule).toContain('`not-reviewed` label');
    expect(normalizedRule).toContain('Do not imply human approval');
    expect(normalizedRule).toContain('When review is requested or required by an explicit gate');
    expect(normalizedRule).toContain('Review may also happen manually later');
    expect(normalizedRule).toContain('Unfinished or blocked Goals and Goals with current acceptance are not eligible');
    expect(normalizedRule).toContain('attaching a CR alone does not request it');
    expect(normalizedRule).toContain('Submit a pinned request naming the reviewer');
    expect(normalizedRule).toContain('Close an unreviewed Goal after its acceptance evidence');
    expect(normalizedRule).toContain('`changes_requested`');
    expect(normalizedRule).toContain('`deferred`');
    expect(normalizedRule).toContain('Always fold finished developers promptly');
    expect(normalizedRule).toContain('after their Goal-attached handoff');
    expect(normalizedRule).toContain('A critical resource fold closes first');
  });
});
