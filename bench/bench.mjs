// Real-output benchmark: runs each command raw, through rtk (if installed),
// and through slimctx's compressor; prints estimated tokens for each.
// Usage: node bench/bench.mjs <repo-dir> ["cmd" ...]
import { spawnSync } from 'node:child_process';
import { compressText } from '../lib/compress.mjs';
import { DEFAULTS } from '../lib/config.mjs';
import { estimateTokens } from '../lib/text.mjs';

const [cwd = process.cwd(), ...custom] = process.argv.slice(2);
const commands = custom.length
  ? custom
  : ['git log -40', 'git status', 'git diff HEAD~3', 'git show HEAD~1', 'npm ls --all', 'ls -la', 'find . -name "*.mjs" -not -path "./node_modules/*"', 'gh api "repos/rtk-ai/rtk/issues?per_page=20"', 'node --test --test-reporter=spec tests/verify-cv-facts-structured-fields.test.mjs'];

const sh = (cmd) => spawnSync('bash', ['-c', cmd], { cwd, encoding: 'utf8', maxBuffer: 64e6, env: { ...process.env, NO_COLOR: '1' } });
const hasRtk = sh('command -v rtk').status === 0;
const rows = [];
for (const cmd of commands) {
  const raw = sh(cmd);
  const text = (raw.stdout || '') + (raw.stderr || '');
  const slim = compressText(text, { command: cmd, cfg: DEFAULTS });
  const rtk = hasRtk ? sh(`rtk ${cmd}`) : null;
  rows.push({
    cmd,
    raw: estimateTokens(text),
    rtk: rtk && rtk.status === 0 ? estimateTokens(rtk.stdout + rtk.stderr) : null,
    slim: estimateTokens(slim.text),
    passes: slim.passes.join(','),
  });
}
const pct = (a, b) => (b == null ? '   n/a' : `${String(Math.round((1 - b / Math.max(a, 1)) * 100)).padStart(5)}%`);
console.log(`${'command'.padEnd(46)} ${'raw'.padStart(7)} ${'rtk'.padStart(7)} ${'slimctx'.padStart(7)}  rtk-cut slim-cut  passes`);
for (const r of rows) {
  console.log(`${r.cmd.slice(0, 46).padEnd(46)} ${String(r.raw).padStart(7)} ${String(r.rtk ?? '-').padStart(7)} ${String(r.slim).padStart(7)}  ${pct(r.raw, r.rtk)}  ${pct(r.raw, r.slim)}  ${r.passes}`);
}
const tot = rows.reduce((a, r) => ({ raw: a.raw + r.raw, slim: a.slim + r.slim }), { raw: 0, slim: 0 });
console.log(`\ntotal raw ${tot.raw} → slimctx ${tot.slim} (${pct(tot.raw, tot.slim).trim()} cut, estimated tokens)`);
