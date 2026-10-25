// Replays real Bash/PowerShell results from local Claude Code transcripts through the
// PostToolUse hook: crash check + real-world savings. Reads only; prints
// aggregates, never output content. Usage: node bench/replay.mjs [--days N]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SLIMCTX_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'slimctx-replay-'));
const { onClaudePost } = await import('../lib/hooks.mjs');
const { estimateTokens } = await import('../lib/text.mjs');

const i = process.argv.indexOf('--days');
const since = Date.now() - (i > 0 ? Number(process.argv[i + 1]) : 30) * 86400e3;
const base = path.join(os.homedir(), '.claude', 'projects');
let n = 0, hit = 0, before = 0, after = 0, errs = 0;
const byPass = {};
const errors = [];
for (const d of fs.existsSync(base) ? fs.readdirSync(base) : []) {
  const dir = path.join(base, d);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    const p = path.join(dir, f);
    if (fs.statSync(p).mtimeMs < since) continue;
    const cmds = new Map();
    for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!l) continue;
      let j;
      try { j = JSON.parse(l); } catch { continue; }
      for (const c of [].concat(j.message?.content || [])) if (c.type === 'tool_use' && (c.name === 'Bash' || c.name === 'PowerShell')) cmds.set(c.id, { ...c.input, tool: c.name });
      const r = j.toolUseResult;
      if (!r || typeof r !== 'object' || typeof r.stdout !== 'string') continue;
      // Skip outputs slimctx itself already condensed live.
      if (r.stdout.includes('[slimctx: ')) continue;
      const tr = [].concat(j.message?.content || []).find((c) => c.type === 'tool_result');
      const input = cmds.get(tr?.tool_use_id);
      if (!input) continue;
      n++;
      const t0 = estimateTokens(r.stdout + (r.stderr ? '\n' + r.stderr : ''));
      before += t0;
      try {
        const out = onClaudePost({ session_id: f, cwd: process.cwd(), tool_name: input.tool, tool_input: input, tool_response: r });
        if (out) {
          hit++;
          const s = out.hookSpecificOutput.updatedToolOutput.stdout;
          after += estimateTokens(s);
          for (const x of ((s.match(/via ([\w,-]+)/) || [])[1] || 'dedup').split(',')) byPass[x] = (byPass[x] || 0) + 1;
        } else after += t0;
      } catch (e) {
        errs++;
        if (errors.length < 10) errors.push(`${String(input.command).slice(0, 60)} :: ${e.message}`);
      }
    }
  }
}
console.log(JSON.stringify({ bashResults: n, condensed: hit, errors: errs, before, after, cut: before ? `${Math.round((1 - after / before) * 100)}%` : '0%', byPass, errorSamples: errors }, null, 2));
