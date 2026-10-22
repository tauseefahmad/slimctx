// `slimctx run -- <cmd...>`: run a command, print its condensed output, exit
// with its exit code. Used by the Claude PreToolUse wrap for commands that
// often fail noisily, and usable by hand from any agent (Codex, Gemini, …).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { loadConfig } from './config.mjs';
import { shrinkCommandOutput } from './hooks.mjs';

// POSIX single-quote re-quoting is exact, so the shell sees the same words
// the caller's shell produced.
const shq = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
const cmdq = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);

function pickShell() {
  const candidates = [process.env.CLAUDE_CODE_GIT_BASH_PATH, process.env.SHELL].filter(Boolean);
  if (process.platform === 'win32') candidates.push('C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe');
  else candidates.push('/bin/bash', '/bin/sh');
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {}
  }
  return null;
}

export function run(argv) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  if (!args.length) {
    process.stderr.write('usage: slimctx run -- <command> [args...]\n');
    process.exit(2);
  }
  const shell = pickShell();
  const child = shell
    ? spawn(shell, ['-c', args.map(shq).join(' ')], { stdio: ['inherit', 'pipe', 'pipe'] })
    : spawn(args.map(cmdq).join(' '), { shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
  let buf = '';
  child.stdout.on('data', (d) => (buf += d));
  child.stderr.on('data', (d) => (buf += d));
  const forward = (sig) => child.kill(sig);
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);
  child.on('error', (e) => {
    process.stderr.write(`slimctx run: ${e.message}\n`);
    process.exit(127);
  });
  child.on('close', (code, signal) => {
    let out = buf;
    try {
      const cfg = loadConfig();
      if (cfg.enabled) {
        const r = shrinkCommandOutput({ text: buf, command: args.join(' '), sessionId: process.env.SLIMCTX_SESSION || `run-${process.ppid}`, cfg, tool: 'run' });
        if (r) out = r.text + '\n';
      }
    } catch {}
    process.stdout.write(out);
    process.exitCode = signal ? 128 : code ?? 1;
  });
}
