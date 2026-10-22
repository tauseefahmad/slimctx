// Config resolution: built-in defaults < user config (<data>/config.json)
// < project config (<cwd>/.slimctx.json). Env SLIMCTX_DISABLE=1 turns
// everything off for one run without touching files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULTS = {
  enabled: true,
  // A rewrite must save at least this many estimated tokens AND this share
  // of the original, otherwise the original passes through untouched.
  // Small outputs are never worth the marker overhead or the risk.
  minSavedTokens: 80,
  minSavedRatio: 0.25,
  // Budget for what survives generic truncation.
  maxLines: 140,
  headLines: 50,
  tailLines: 40,
  importantLines: 40,
  // Collapse a run of near-identical lines once it reaches this length.
  similarRun: 4,
  // Cross-call dedup window (per session).
  dedupWindow: 16,
  // Keep the full original on disk so nothing is lost; the marker says where.
  stash: true,
  stashDays: 7,
  // Claude Code only: route noisy test/build/install commands through the
  // wrapper so their output is compressed even when they exit non-zero
  // (PostToolUse does not fire for failures, PostToolUseFailure cannot
  // rewrite). "auto" = on unless another PreToolUse Bash rewriter (rtk) is
  // installed, since two hooks returning updatedInput race.
  wrap: 'auto',
  // Outline-first reads: a whole-file Read of a large code file returns its
  // symbol outline with line numbers first. Asking again reads it in full.
  outline: { enabled: true, minLines: 600 },
  grep: { maxPerFile: 15, maxFiles: 40 },
  glob: { maxEntries: 120 },
  // Reply style injected at session start: off | lite | full
  terse: 'lite',
  // Commands (regex on the command string) that are never touched.
  bypass: [],
};

export function dataDir() {
  const d =
    process.env.SLIMCTX_DATA ||
    process.env.CLAUDE_PLUGIN_DATA ||
    process.env.PLUGIN_DATA ||
    path.join(os.homedir(), '.slimctx');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function merge(base, over) {
  if (!over || typeof over !== 'object') return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
        ? { ...base[k], ...v }
        : v;
  }
  return out;
}

export function userConfigPath() {
  return path.join(dataDir(), 'config.json');
}

export function loadConfig(cwd = process.cwd()) {
  let cfg = merge(DEFAULTS, readJson(userConfigPath()));
  cfg = merge(cfg, readJson(path.join(cwd, '.slimctx.json')));
  if (process.env.SLIMCTX_DISABLE === '1') cfg.enabled = false;
  return cfg;
}

export function saveUserConfig(patch) {
  const file = userConfigPath();
  const next = merge(readJson(file) || {}, patch);
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return next;
}
