#!/usr/bin/env node
// slimctx CLI. Hook entrypoints read the host's JSON payload on stdin and
// print the reply JSON (or nothing). They always exit 0: a failure inside
// slimctx degrades to "original output", never to a broken tool call.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const HELP = `slimctx — fewer tokens for Claude Code and Codex

  slimctx run -- <cmd...>      run a command, print condensed output, keep exit code
  slimctx compress [--cmd C]   condense stdin (try it on any log)
  slimctx gain [--days N] [--json]   estimated tokens saved
  slimctx audit                what loads into context before you type
  slimctx doctor               setup check + hook errors logged in the last 7 days
  slimctx terse off|lite|full  reply-style rules injected at session start
  slimctx config [key value]   show or set a user config value (JSON value)
  slimctx hook <session|pre|post|codex-post>   host hook entrypoints (stdin JSON)
`;

function readStdin() {
  return new Promise((resolve) => {
    let d = '';
    if (process.stdin.isTTY) return resolve('');
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (d += c));
    process.stdin.on('end', () => resolve(d));
  });
}

async function hook(kind, host) {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    return;
  }
  const t0 = Date.now();
  try {
    const h = await import('../lib/hooks.mjs');
    const out =
      kind === 'session' ? h.onSessionStart(payload, host)
      : kind === 'pre' ? h.onClaudePre(payload, ROOT)
      : kind === 'post' ? h.onClaudePost(payload)
      : kind === 'codex-post' ? h.onCodexPost(payload)
      : null;
    if (out) process.stdout.write(JSON.stringify(out));
    const ms = Date.now() - t0;
    if (ms > 1500) (await import('../lib/store.mjs')).logIssue({ kind: 'slow', hook: kind, host, tool: payload.tool_name, ms });
  } catch (e) {
    // Swallowed for the host (the tool call must not break), kept for
    // `slimctx doctor` so silent failures still get found and fixed.
    try {
      (await import('../lib/store.mjs')).logIssue({ kind: 'error', hook: kind, host, tool: payload.tool_name, cmd: String(payload.tool_input?.command || payload.tool_input?.file_path || '').slice(0, 120), error: String(e.stack || e).slice(0, 1500) });
    } catch {}
    if (process.env.SLIMCTX_DEBUG) process.stderr.write(`slimctx: ${e.stack}\n`);
  }
}

export async function main(argv) {
  const [cmd, ...rest] = argv;
  const flag = (name, def) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] ?? true : def;
  };
  switch (cmd) {
    case 'hook':
      return hook(rest[0], flag('--host', 'claude'));
    case 'run':
      return (await import('../lib/run.mjs')).run(rest);
    case 'compress': {
      const { compressText } = await import('../lib/compress.mjs');
      const { loadConfig } = await import('../lib/config.mjs');
      const { estimateTokens } = await import('../lib/text.mjs');
      const input = await readStdin();
      const { text, passes } = compressText(input, { command: flag('--cmd', ''), cfg: loadConfig() });
      process.stdout.write(text + '\n');
      process.stderr.write(`[slimctx: ~${estimateTokens(input)}→${estimateTokens(text)} tokens (est.) via ${passes.join(',') || 'nothing'}]\n`);
      return;
    }
    case 'gain':
      return console.log((await import('../lib/report.mjs')).gain({ days: Number(flag('--days', 30)), json: rest.includes('--json') }));
    case 'doctor':
      return console.log((await import('../lib/report.mjs')).doctor());
    case 'version':
    case '--version':
      return console.log((await import('../lib/version.mjs')).VERSION);
    case 'audit':
      return console.log((await import('../lib/report.mjs')).audit(process.cwd()));
    case 'terse': {
      const level = rest[0];
      if (!['off', 'lite', 'full'].includes(level)) return console.log('usage: slimctx terse off|lite|full');
      (await import('../lib/config.mjs')).saveUserConfig({ terse: level });
      return console.log(`slimctx: terse = ${level} (applies from the next session start / resume / compact)`);
    }
    case 'config': {
      const c = await import('../lib/config.mjs');
      if (rest.length >= 2) {
        let v = rest.slice(1).join(' ');
        try { v = JSON.parse(v); } catch {}
        const parts = rest[0].split('.');
        const patch = parts.length === 2 ? { [parts[0]]: { [parts[1]]: v } } : { [rest[0]]: v };
        c.saveUserConfig(patch);
      }
      return console.log(`${c.userConfigPath()}\n${JSON.stringify(c.loadConfig(), null, 2)}`);
    }
    default:
      process.stdout.write(HELP);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
