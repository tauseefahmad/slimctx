// node scripts/release.mjs <patch|minor|major> "changelog line" ["line" ...]
// Bumps every manifest in step, prepends CHANGELOG.md, runs the tests, then
// commits, tags, pushes and creates the GitHub release. Stops on any failure.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [kind = 'patch', ...notes] = process.argv.slice(2);
if (!['patch', 'minor', 'major'].includes(kind) || !notes.length) {
  console.error('usage: node scripts/release.mjs <patch|minor|major> "change" ["change" ...]');
  process.exit(2);
}
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
const vfile = path.join(ROOT, 'lib/version.mjs');
const cur = fs.readFileSync(vfile, 'utf8').match(/VERSION = '(\d+)\.(\d+)\.(\d+)'/).slice(1).map(Number);
const next = kind === 'major' ? [cur[0] + 1, 0, 0] : kind === 'minor' ? [cur[0], cur[1] + 1, 0] : [cur[0], cur[1], cur[2] + 1];
const v = next.join('.');

fs.writeFileSync(vfile, fs.readFileSync(vfile, 'utf8').replace(/VERSION = '[^']+'/, `VERSION = '${v}'`));
for (const f of ['package.json', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
  const p = path.join(ROOT, f);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.version = v;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
}
const cl = path.join(ROOT, 'CHANGELOG.md');
const old = fs.existsSync(cl) ? fs.readFileSync(cl, 'utf8').replace(/^# Changelog\n+/, '') : '';
const entry = `## ${v} — ${new Date().toISOString().slice(0, 10)}\n\n${notes.map((n) => `- ${n}`).join('\n')}\n\n`;
fs.writeFileSync(cl, `# Changelog\n\n${entry}${old}`);

run(process.execPath, ['--test', 'test/slimctx.test.mjs']);
run('git', ['add', '-A']);
run('git', ['commit', '-m', `release: v${v}\n\n${notes.map((n) => `- ${n}`).join('\n')}`]);
run('git', ['tag', `v${v}`]);
run('git', ['push', 'origin', 'HEAD', '--tags']);
run('gh', ['release', 'create', `v${v}`, '--title', `slimctx v${v}`, '--notes', entry.split('\n').slice(2).join('\n')]);
console.log(`released v${v}`);
