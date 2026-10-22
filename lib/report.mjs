// `slimctx gain` (what was saved) and `slimctx audit` (what loads before
// you type). All counts are estimates and say so.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataDir, loadConfig } from './config.mjs';
import { readIssues, readLedger } from './store.mjs';
import { VERSION } from './version.mjs';
import { estimateTokens } from './text.mjs';

const fmt = (n) => Math.round(n).toLocaleString('en-US');

export function gain({ days = 30, json = false } = {}) {
  const since = Date.now() - days * 86400e3;
  const rows = readLedger().filter((r) => Date.parse(r.t) >= since);
  const tot = { n: rows.length, before: 0, after: 0 };
  const byPass = new Map();
  const byCmd = new Map();
  const byDay = new Map();
  for (const r of rows) {
    tot.before += r.before;
    tot.after += r.after;
    const saved = r.before - r.after;
    for (const p of r.passes || []) byPass.set(p, (byPass.get(p) || 0) + saved / (r.passes.length || 1));
    const key = `${r.tool}: ${String(r.cmd || '').split(/\s+/).slice(0, 2).join(' ')}`;
    const c = byCmd.get(key) || { n: 0, saved: 0 };
    c.n++;
    c.saved += saved;
    byCmd.set(key, c);
    const d = r.t.slice(0, 10);
    byDay.set(d, (byDay.get(d) || 0) + saved);
  }
  const saved = tot.before - tot.after;
  if (json) return JSON.stringify({ days, ...tot, saved, byPass: Object.fromEntries(byPass), byCmd: Object.fromEntries(byCmd), byDay: Object.fromEntries(byDay) }, null, 2);
  if (!rows.length) return `slimctx: nothing compressed in the last ${days} days yet.`;
  const lines = [
    `slimctx savings, last ${days} days (token counts are estimates)`,
    `  ${fmt(tot.n)} outputs condensed · ${fmt(tot.before)} → ${fmt(tot.after)} tokens · saved ~${fmt(saved)} (${Math.round((saved / tot.before) * 100)}%)`,
    '',
    'by technique:',
    ...[...byPass.entries()].sort((a, b) => b[1] - a[1]).map(([p, s]) => `  ${p.padEnd(14)} ~${fmt(s)}`),
    '',
    'top commands:',
    ...[...byCmd.entries()].sort((a, b) => b[1].saved - a[1].saved).slice(0, 10).map(([k, c]) => `  ${k.slice(0, 40).padEnd(40)} ×${String(c.n).padEnd(4)} ~${fmt(c.saved)}`),
  ];
  return lines.join('\n');
}

export function doctor() {
  const issues = readIssues();
  const since = Date.now() - 7 * 86400e3;
  const recent = issues.filter((i) => Date.parse(i.t) >= since);
  const errors = recent.filter((i) => i.kind === 'error');
  const slow = recent.filter((i) => i.kind === 'slow');
  const ledger = readLedger();
  const cfg = loadConfig();
  const [major] = process.versions.node.split('.').map(Number);
  const lines = [
    `slimctx ${VERSION} · node ${process.versions.node}${major < 18 ? '  ✗ needs node ≥ 18' : ''}`,
    `data dir: ${dataDir()}`,
    `enabled: ${cfg.enabled} · terse: ${cfg.terse} · wrap: ${cfg.wrap} · outline: ${cfg.outline?.enabled ? cfg.outline.minLines + '+ lines' : 'off'}`,
    `condensed outputs recorded: ${ledger.length}`,
    `last 7 days: ${errors.length} hook errors, ${slow.length} slow hooks (>1.5s)`,
  ];
  const groups = new Map();
  for (const e of errors) {
    const key = String(e.error).split('\n')[0];
    const g = groups.get(key) || { n: 0, last: e };
    g.n++;
    g.last = e;
    groups.set(key, g);
  }
  for (const [msg, g] of [...groups].sort((a, b) => b[1].n - a[1].n).slice(0, 10)) {
    lines.push(`  ×${g.n} [${g.last.hook}/${g.last.tool}] ${msg}`, `     last: ${g.last.t} cmd: ${g.last.cmd}`);
  }
  return lines.join('\n');
}

// Follow @imports in CLAUDE.md the way Claude Code does (one level of
// relative/home paths is enough for an estimate).
function withImports(file, seen = new Set()) {
  if (seen.has(file) || seen.size > 30) return [];
  seen.add(file);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [{ file, tokens: estimateTokens(text) }];
  for (const m of text.matchAll(/(?:^|\s)@((?:~\/|\.{0,2}\/)?[\w./-]+\.md)\b/gm)) {
    const p = m[1].startsWith('~/') ? path.join(os.homedir(), m[1].slice(2)) : path.resolve(path.dirname(file), m[1]);
    out.push(...withImports(p, seen));
  }
  return out;
}

function skillDescriptions(dir) {
  let total = 0;
  let n = 0;
  try {
    for (const s of fs.readdirSync(dir)) {
      const f = path.join(dir, s, 'SKILL.md');
      try {
        const fm = fs.readFileSync(f, 'utf8').match(/^---\n([\s\S]*?)\n---/);
        if (fm) { total += estimateTokens(fm[1]); n++; }
      } catch {}
    }
  } catch {}
  return { n, total };
}

export function audit(cwd = process.cwd()) {
  const home = os.homedir();
  const files = [
    ...withImports(path.join(home, '.claude', 'CLAUDE.md')),
    ...withImports(path.join(cwd, 'CLAUDE.md')),
    ...withImports(path.join(cwd, 'CLAUDE.local.md')),
    ...withImports(path.join(cwd, '.claude', 'CLAUDE.md')),
    ...withImports(path.join(home, '.codex', 'AGENTS.md')),
    ...withImports(path.join(cwd, 'AGENTS.md')),
  ];
  const memDir = path.join(home, '.claude', 'projects', cwd.replace(/[:\\/]/g, '-'), 'memory', 'MEMORY.md');
  files.push(...withImports(memDir));
  const uniq = [...new Map(files.map((f) => [path.resolve(f.file), f])).values()];
  const skills = [skillDescriptions(path.join(home, '.claude', 'skills')), skillDescriptions(path.join(cwd, '.claude', 'skills'))];
  const total = uniq.reduce((a, f) => a + f.tokens, 0) + skills.reduce((a, s) => a + s.total, 0);
  const cfg = loadConfig(cwd);
  const lines = [
    `Context loaded before your first message (estimated tokens), cwd ${cwd}`,
    ...uniq.sort((a, b) => b.tokens - a.tokens).map((f) => `  ${fmt(f.tokens).padStart(7)}  ${f.file}${f.tokens > 4000 ? '   ← large: move detail into files read on demand' : ''}`),
    `  ${fmt(skills[0].total + skills[1].total).padStart(7)}  skill descriptions (${skills[0].n + skills[1].n} skills)`,
    `  ${fmt(total).padStart(7)}  total (MCP tool schemas and the system prompt come on top)`,
    '',
    'Notes:',
  ];
  if (uniq.some((f) => /AGENTS\.md$/.test(f.file)) && uniq.some((f) => /CLAUDE\.md$/.test(f.file) && fs.readFileSync(f.file, 'utf8').includes('@AGENTS.md'))) {
    lines.push('  · CLAUDE.md imports AGENTS.md: Claude pays for both, Codex reads AGENTS.md directly. That is the right shape.');
  }
  if (total > 15000) lines.push('  · Over 15k tokens load on every request. Prune finished-task notes and long tables; keep CLAUDE.md a cheat sheet.');
  lines.push(`  · slimctx terse mode: ${cfg.terse}; wrap: ${cfg.wrap}; outline-first reads: ${cfg.outline?.enabled ? `on (≥${cfg.outline.minLines} lines)` : 'off'}.`);
  return lines.join('\n');
}
