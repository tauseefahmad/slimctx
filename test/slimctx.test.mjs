import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slimctx-test-'));
process.env.SLIMCTX_DATA = tmp;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { compressText, worthIt } = await import('../lib/compress.mjs');
const { DEFAULTS } = await import('../lib/config.mjs');
const { onClaudePost, onClaudePre, onCodexPost, onSessionStart, wrapCommand } = await import('../lib/hooks.mjs');
const { estimateTokens } = await import('../lib/text.mjs');
const F = await import('./fixtures.mjs');

const cfg = { ...DEFAULTS };
const ratio = (a, b) => estimateTokens(b) / estimateTokens(a);
let sid = 0;
const bash = (command, stdout, extra = {}) => ({
  session_id: `s${++sid}`,
  cwd: tmp,
  tool_name: 'Bash',
  tool_input: { command },
  tool_response: { stdout, stderr: '', interrupted: false, isImage: false, noOutputExpected: false, ...extra },
});

test('npm install noise collapses, summary survives', () => {
  const { text, passes } = compressText(F.npmInstall, { command: 'npm install', cfg });
  assert.ok(passes.includes('noise'));
  assert.match(text, /added 412 packages/);
  assert.match(text, /found 0 vulnerabilities/);
  assert.ok(ratio(F.npmInstall, text) < 0.3, `ratio ${ratio(F.npmInstall, text)}`);
});

test('jest: passing lines dropped, failure block and summary kept', () => {
  const { text } = compressText(F.jestFail, { command: 'npm test', cfg });
  assert.match(text, /rejects bad input/);
  assert.match(text, /src\/b\.test\.js:13:30/);
  assert.match(text, /Tests:\s+1 failed, 90 passed/);
  assert.doesNotMatch(text, /handles case 5 /);
  assert.ok(ratio(F.jestFail, text) < 0.35);
});

test('go test -v: keeps FAIL and the assertion', () => {
  const { text } = compressText(F.goTest, { command: 'go test -v ./...', cfg });
  assert.match(text, /got 3, want 4/);
  assert.match(text, /--- FAIL: TestBroken/);
  assert.doesNotMatch(text, /TestThing7\b/);
});

test('git log default format becomes one line per commit', () => {
  const { text, passes } = compressText(F.gitLog, { command: 'git log', cfg });
  assert.ok(passes.includes('git-log'));
  assert.equal(text.split('\n').length, 12);
  assert.match(text, /feat: change number 11 — Dev Person, Mon Oct 21/);
});

test('git log with explicit format is left alone', () => {
  const { passes } = compressText(F.gitLog, { command: 'git log --format=%H', cfg });
  assert.ok(!passes.includes('git-log'));
});

test('git status: hints dropped, untracked grouped by directory', () => {
  const { text } = compressText(F.gitStatus, { command: 'git status', cfg });
  assert.match(text, /build\/ \(40 files\)/);
  assert.match(text, /docs\/ \(10 files\)/);
  assert.match(text, /\tnotes\.txt/);
  assert.match(text, /modified:\s+src\/index\.js/);
  assert.doesNotMatch(text, /use "git add <file>/);
});

test('git diff: real hunks kept verbatim, lockfile summarised', () => {
  const { text } = compressText(F.gitDiffLock, { command: 'git diff', cfg });
  assert.match(text, /^-const b = 2;$/m);
  assert.match(text, /^\+const b = 3;$/m);
  assert.match(text, /lockfile diff summarised: \+150 -150/);
  assert.doesNotMatch(text, /^index /m);
});

test('JSON: long arrays keep head, tail and the error item', () => {
  const { text } = compressText(F.jsonArray, { command: 'curl api', cfg });
  const body = JSON.parse(text.split('\n').slice(1).join('\n'));
  assert.equal(body.total, 200);
  assert.ok(body.items.some((x) => x && x.status === 'error' && x.id === 137));
  assert.ok(body.items.some((x) => typeof x === 'string' && /more items/.test(x)));
  assert.ok(ratio(F.jsonArray, text) < 0.15);
});

test('log spam: similar runs fold, the buried ERROR survives', () => {
  const { text } = compressText(F.logSpam, { command: 'docker logs api', cfg });
  assert.match(text, /ERROR database connection refused/);
  assert.match(text, /similar lines/);
  assert.match(text, /server stopped/);
  assert.ok(ratio(F.logSpam, text) < 0.1);
});

test('small outputs are never touched', () => {
  assert.equal(onClaudePost(bash('ls', 'a\nb\nc\n')), null);
});

test('worthIt refuses marginal savings', () => {
  const s = 'x '.repeat(500);
  assert.equal(worthIt(s, s.slice(0, 950), cfg), null);
});

test('Claude PostToolUse Bash: shape kept, footer names a readable stash', () => {
  const out = onClaudePost(bash('npm install', F.npmInstall));
  const u = out.hookSpecificOutput.updatedToolOutput;
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.deepEqual(Object.keys(u).sort(), ['interrupted', 'isImage', 'noOutputExpected', 'stderr', 'stdout']);
  const file = u.stdout.match(/full output: (\S+)\]/)[1];
  assert.equal(fs.readFileSync(file, 'utf8'), F.npmInstall);
});

test('Claude PostToolUse: raw marker, persisted output and wrapper output bypass', () => {
  assert.equal(onClaudePost(bash('npm install # slimctx:raw', F.npmInstall)), null);
  assert.equal(onClaudePost(bash('npm install', F.npmInstall, { persistedOutputPath: '/x' })), null);
  assert.equal(onClaudePost(bash('npm install', F.npmInstall + '\n[slimctx: ~1→1 tokens]')), null);
});

test('explicit file reads pass through untouched; shell greps get the per-file cap', () => {
  assert.equal(onClaudePost(bash('sed -n 1,400p src/app.js', F.logSpam)), null);
  assert.equal(onClaudePost(bash('wc -l a.md; cat a.md', F.logSpam)), null);
  assert.equal(onClaudePost(bash('cd x && head -500 server.log', F.logSpam)), null);
  // PowerShell's head/tail: the model picked those lines.
  const ps = (command) => ({ ...bash(command, F.logSpam), tool_name: 'PowerShell' });
  assert.equal(onClaudePost(ps('mvn -B verify 2>&1 | Select-Object -Last 300')), null);
  assert.equal(onClaudePost(ps('Get-ChildItem -Recurse | select -first 400')), null);
  assert.ok(onClaudePost(ps('mvn -B verify 2>&1')));
  const hits = Array.from({ length: 3 }, (_, f) => Array.from({ length: 80 }, (_, i) => `lib/m${f}.mjs:${i + 1}:  const cat = load(${i});`).join('\n')).join('\n');
  const out = onClaudePost(bash('grep -rn "const cat" lib', hits)).hookSpecificOutput.updatedToolOutput.stdout;
  assert.match(out, /lib\/m0\.mjs: … 65 more matches in this file/);
  assert.match(out, /grep-cap/);
});

test('cross-call dedup answers a repeat with a pointer', () => {
  const p1 = bash('npm test', F.jestFail);
  const p2 = { ...bash('npm test', F.jestFail), session_id: p1.session_id };
  onClaudePost(p1);
  const second = onClaudePost(p2).hookSpecificOutput.updatedToolOutput.stdout;
  assert.match(second, /identical to the output of `npm test`/);
});

test('Grep content mode capped per file', () => {
  const content = Array.from({ length: 5 }, (_, f) => Array.from({ length: 60 }, (_, i) => `src/f${f}.js:${i + 1}:  foo(${i}) // call site`).join('\n')).join('\n');
  const out = onClaudePost({ session_id: 'g', cwd: tmp, tool_name: 'Grep', tool_input: { pattern: 'foo' }, tool_response: { mode: 'content', numFiles: 0, filenames: [], content, numLines: 300 } });
  const c = out.hookSpecificOutput.updatedToolOutput.content;
  assert.match(c, /src\/f0\.js: … 45 more matches in this file/);
  assert.equal(out.hookSpecificOutput.updatedToolOutput.mode, 'content');
});

test('Glob list summarised by directory, stays an array of strings', () => {
  const filenames = Array.from({ length: 400 }, (_, i) => `C:/repo/src/${i % 4 ? 'components' : 'utils'}/f${i}.ts`);
  const out = onClaudePost({ session_id: 'gl', cwd: tmp, tool_name: 'Glob', tool_input: { pattern: '**/*.ts' }, tool_response: { filenames, numFiles: 400, durationMs: 3, truncated: false } });
  const list = out.hookSpecificOutput.updatedToolOutput.filenames;
  assert.ok(Array.isArray(list) && list.every((x) => typeof x === 'string'));
  assert.equal(list.length, cfg.glob.maxEntries + 2);
  assert.match(list.at(-2), /more in C:\/repo\/src\/components\//);
});

test('outline-first: first whole-file Read denied with outline, second allowed', () => {
  const file = path.join(tmp, 'big.ts');
  fs.writeFileSync(file, F.bigTs);
  const p = { session_id: 'o1', cwd: tmp, tool_name: 'Read', tool_input: { file_path: file } };
  const first = onClaudePre(p);
  assert.equal(first.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(first.hookSpecificOutput.permissionDecisionReason, /\b3  export function handler0/);
  assert.match(first.hookSpecificOutput.permissionDecisionReason, /async findAll/);
  assert.equal(onClaudePre(p), null);
  assert.equal(onClaudePre({ ...p, session_id: 'o2', tool_input: { file_path: file, offset: 10, limit: 50 } }), null);
});

test('wrapCommand: only simple noisy commands, cd prefix kept', () => {
  assert.match(wrapCommand('npm test', ROOT), /^node ".*slimctx\.mjs" run -- npm test$/);
  assert.match(wrapCommand('cd "my dir" && pytest -q 2>&1', ROOT), /^cd "my dir" && node ".*" run -- pytest -q$/);
  assert.equal(wrapCommand('npm test | tail -5', ROOT), null);
  assert.equal(wrapCommand('git status', ROOT), null);
  assert.equal(wrapCommand('npm test && rm -rf x', ROOT), null);
  assert.equal(wrapCommand('echo $(npm test)', ROOT), null);
});

test('Codex PostToolUse: header kept, body condensed, returned as block reason', () => {
  const text = `Exit code: 1\nWall time: 2.3 seconds\nOutput:\n${F.jestFail}`;
  const out = onCodexPost({ session_id: 'c1', cwd: tmp, tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: text });
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /^Exit code: 1\nWall time: 2\.3 seconds\nOutput:\n/);
  assert.match(out.reason, /rejects bad input/);
  assert.match(out.reason, /not an error/);
});

test('SessionStart injects protocol + lite rules', () => {
  const out = onSessionStart({ cwd: tmp }, 'claude');
  assert.match(out.hookSpecificOutput.additionalContext, /slimctx:raw/);
  assert.match(out.hookSpecificOutput.additionalContext, /lead with the answer/);
  assert.ok(estimateTokens(out.hookSpecificOutput.additionalContext) < 220);
});

test('hook CLI: garbage stdin is a silent no-op', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/slimctx.mjs'), 'hook', 'post'], { input: 'not json', env: { ...process.env } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.toString(), '');
});

test('a crashing hook is silent for the host but logged for doctor', async () => {
  // tool_response with a getter that throws simulates an unexpected shape.
  const r = spawnSync(process.execPath, ['-e', `(async () => {
    process.env.SLIMCTX_DATA=${JSON.stringify(tmp)};
    const h = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'lib/hooks.mjs')).href)});
    const s = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'lib/store.mjs')).href)});
    try { h.onClaudePost({ cwd: '.', tool_name: 'Bash', tool_input: { command: 'x' }, tool_response: { get stdout() { throw new Error('boom-shape'); } } }); }
    catch (e) { s.logIssue({ kind: 'error', hook: 'post', tool: 'Bash', error: e.stack }); }
  })()`], { input: '', env: { ...process.env } });
  assert.equal(r.status, 0, r.stderr.toString());
  const { doctor } = await import('../lib/report.mjs');
  assert.match(doctor(), /1 hook errors/);
  assert.match(doctor(), /boom-shape/);
});

test('hook CLI end to end via stdin', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/slimctx.mjs'), 'hook', 'post'], { input: JSON.stringify(bash('npm install', F.npmInstall)), env: { ...process.env } });
  assert.equal(r.status, 0);
  assert.match(JSON.parse(r.stdout.toString()).hookSpecificOutput.updatedToolOutput.stdout, /added 412 packages/);
});

test('run wrapper keeps the exit code and condenses', () => {
  const script = path.join(tmp, 'noisy.mjs');
  fs.writeFileSync(script, `for (let i=0;i<400;i++) console.log('Downloading pkg-'+i+' v1.0.'+i); console.error('ERROR boom'); process.exit(3);`);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'bin/slimctx.mjs'), 'run', '--', 'node', script], { env: { ...process.env } });
  assert.equal(r.status, 3);
  const out = r.stdout.toString();
  assert.match(out, /ERROR boom/);
  assert.match(out, /\[slimctx: /);
  assert.ok(out.length < 2000, `len ${out.length}`);
});

test('codex hook command resolves via PLUGIN_ROOT env', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/codex-hooks.json'), 'utf8'));
  const cmd = hooks.hooks.PostToolUse[0].hooks[0].command;
  const js = cmd.match(/^node -e "(.*)"$/)[1];
  const text = `Exit code: 0\nWall time: 1 seconds\nOutput:\n${F.npmInstall}`;
  const r = spawnSync(process.execPath, ['-e', js], {
    input: JSON.stringify({ session_id: 'cx', cwd: tmp, tool_name: 'Bash', tool_input: { command: 'npm i' }, tool_response: text }),
    env: { ...process.env, PLUGIN_ROOT: ROOT },
  });
  assert.equal(r.status, 0, r.stderr.toString());
  assert.equal(JSON.parse(r.stdout.toString()).decision, 'block');
});

test('a script printing its own PASS/FAIL report keeps every line', () => {
  const report = ['== run-a.json', ...Array.from({ length: 12 }, (_, i) => `  PASS case-${i} | answer text ${i}`), '  FAIL case-x | wrong answer'].join('\n');
  const command = `python -I -c "import json\nfor f in ('a.json',): print(t['tests'])"`;
  const { text, passes } = compressText(report, { command, cfg });
  assert.ok(!passes.includes('tests'));
  assert.match(text, /PASS case-11 \| answer text 11/);
});

test('jest file header PASS lines still drop behind a test command', () => {
  const out = [...Array.from({ length: 8 }, (_, i) => `PASS src/m${i}.test.ts (1.2 s)`), 'Tests:       8 passed, 8 total'].join('\n');
  const { text, passes } = compressText(out, { command: 'npx jest', cfg });
  assert.ok(passes.includes('tests'));
  assert.doesNotMatch(text, /m3\.test\.ts/);
  assert.match(text, /8 passed/);
});

test('truncate keeps section headers from the omitted middle', () => {
  const words = ['Dataset', 'Catalog', 'Fair', 'Order', 'Error', 'Access', 'Report', 'Service', 'Config', 'Mapper', 'Schema', 'Index'];
  const lines = [];
  for (let p = 1; p <= 16; p++) {
    lines.push(`repo part ${p} at 2026-10-24 (12 files): message ${p}`);
    for (let f = 0; f < 12; f++) lines.push(`    M ${f % 2 ? 'backend/src' : 'frontend/app'}/${words[(f + p) % 12].toLowerCase()}/${words[(f * 5 + p) % 12]}${words[f]}.${f % 3 ? 'java' : 'tsx'}`);
  }
  const { text, passes } = compressText(lines.join('\n'), { command: 'python plan.py --dry-run', cfg });
  assert.ok(passes.includes('truncate'));
  for (let p = 1; p <= 16; p++) assert.match(text, new RegExp(`repo part ${p} at`));
  assert.match(text, /lines omitted/);
  assert.ok(text.split('\n').length < lines.length * 0.7);
});
