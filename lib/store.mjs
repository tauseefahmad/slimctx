// On-disk state: stashed originals (lossless recovery), the savings ledger,
// and small per-session state (dedup ring, files already outlined).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './config.mjs';
import { VERSION } from './version.mjs';

const safe = (s) => String(s || 'nosession').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);

export function stashDir() {
  const d = path.join(dataDir(), 'stash');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function hash(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}

// Forward slashes: the path is pasted into Bash (Git Bash on Windows) and
// Read alike, and both accept them.
export function stash(sessionId, text, label = 'out') {
  const name = `${safe(sessionId).slice(0, 12)}-${Date.now().toString(36)}-${hash(text).slice(0, 6)}-${safe(label).slice(0, 20)}.txt`;
  const file = path.join(stashDir(), name);
  fs.writeFileSync(file, text);
  return file.split(path.sep).join('/');
}

export function isStashPath(p) {
  if (!p) return false;
  const norm = String(p).replace(/\\/g, '/').toLowerCase();
  return norm.includes('/stash/') && norm.includes(dataDir().replace(/\\/g, '/').toLowerCase());
}

export function pruneStash(days) {
  const cutoff = Date.now() - days * 86400e3;
  let removed = 0;
  for (const f of fs.readdirSync(stashDir())) {
    const p = path.join(stashDir(), f);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) {
        fs.unlinkSync(p);
        removed++;
      }
    } catch {}
  }
  for (const f of fs.readdirSync(dataDir())) {
    if (!f.startsWith('session-')) continue;
    const p = path.join(dataDir(), f);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    } catch {}
  }
  return removed;
}

function sessionFile(sessionId) {
  return path.join(dataDir(), `session-${safe(sessionId)}.json`);
}

export function loadSession(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(sessionId), 'utf8'));
  } catch {
    return { calls: 0, recent: [], outlined: [] };
  }
}

// Parallel tool calls fire hooks concurrently; write-then-rename keeps the
// file whole. A lost update only costs one dedup hit, never correctness.
export function saveSession(sessionId, state) {
  const file = sessionFile(sessionId);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state));
  try {
    fs.renameSync(tmp, file);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

export function ledgerPath() {
  return path.join(dataDir(), 'ledger.jsonl');
}

export function record(entry) {
  try {
    fs.appendFileSync(ledgerPath(), JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n');
  } catch {}
}

export function issuesPath() {
  return path.join(dataDir(), 'issues.jsonl');
}

export function logIssue(entry) {
  try {
    fs.appendFileSync(issuesPath(), JSON.stringify({ t: new Date().toISOString(), v: VERSION, ...entry }) + '\n');
  } catch {}
}

export function readIssues() {
  try {
    return fs.readFileSync(issuesPath(), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

export function readLedger() {
  try {
    return fs
      .readFileSync(ledgerPath(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
