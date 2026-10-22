// The pipeline: clean → specialised filter (json | git | tests) → noise →
// generic collapse → truncate. Returns the new text plus which passes fired;
// the caller decides whether the saving is worth replacing the original.
import { applyGit, gitSubcommand } from './filters/git.mjs';
import { collapseBlank, collapseExactRuns, collapseSimilarRuns, truncate } from './filters/generic.mjs';
import { compressJson } from './filters/json.mjs';
import { compressPathList, lsLong, pathList } from './filters/listing.mjs';
import { dropNoise } from './filters/noise.mjs';
import { dropPassing, looksLikeTests } from './filters/tests.mjs';
import { clean, estimateTokens, splitLines } from './text.mjs';

export function compressText(text, { command = '', cfg }) {
  const passes = [];
  const cleaned = clean(text);
  if (cleaned.length < text.length - 16) passes.push('ansi');

  const json = compressJson(cleaned);
  if (json !== null) {
    passes.push('json');
    return { text: json, passes };
  }

  let lines = splitLines(cleaned);
  const git = applyGit(command, lines);
  if (git && git.saved > 0) {
    lines = git.lines;
    passes.push(`git-${gitSubcommand(command).sub}`);
  }
  const isDiff = /^(diff|show|log)$/.test(gitSubcommand(command)?.sub || '') || /^\s*diff\b/.test(command);

  const ls = !isDiff && lsLong(lines);
  if (ls) {
    lines = ls;
    passes.push('ls');
  }
  const paths = !isDiff && pathList(lines, cfg.glob.maxEntries);
  if (paths) {
    passes.push('paths');
    return { text: paths.join('\n'), passes };
  }

  if (!isDiff && looksLikeTests(command, lines)) {
    const t = dropPassing(lines);
    if (t.dropped) {
      lines = t.lines;
      passes.push('tests');
    }
  }
  if (!isDiff) {
    const n = dropNoise(lines);
    if (n.saved) {
      lines = n.lines;
      passes.push('noise');
    }
  }

  lines = collapseBlank(lines);
  const ex = collapseExactRuns(lines);
  if (ex.saved) {
    lines = ex.lines;
    passes.push('dedup-lines');
  }
  // Diff lines that look alike are still distinct edits; never fold them.
  if (!isDiff) {
    const sim = collapseSimilarRuns(lines, cfg.similarRun);
    if (sim.saved) {
      lines = sim.lines;
      passes.push('similar');
    }
  }
  // A diff already got a per-file budget; only a last-resort cap here.
  const tr = truncate(lines, isDiff ? { ...cfg, maxLines: cfg.maxLines * 3, headLines: cfg.maxLines * 2, tailLines: cfg.tailLines } : cfg);
  if (tr.omitted) {
    lines = tr.lines;
    passes.push('truncate');
  }
  return { text: lines.join('\n'), passes };
}

// Decide whether a rewrite pays for itself. Returns null to pass through.
export function worthIt(original, compressed, cfg, footer = '') {
  const before = estimateTokens(original);
  const after = estimateTokens(compressed) + estimateTokens(footer);
  const saved = before - after;
  if (saved < cfg.minSavedTokens || saved / Math.max(before, 1) < cfg.minSavedRatio) return null;
  return { before, after, saved };
}

// Grep content mode: cap matches per file and files overall, keeping the
// first matches of each file (usually the definition) and a per-file count.
export { compressPathList };

export function compressGrepContent(content, cfg) {
  const lines = splitLines(content);
  const byFile = new Map();
  const order = [];
  for (const l of lines) {
    const m = l.match(/^(.+?)[:-](\d+)[:-]/) || l.match(/^(.+?):/);
    const f = m ? m[1] : '';
    if (!byFile.has(f)) {
      byFile.set(f, []);
      order.push(f);
    }
    byFile.get(f).push(l);
  }
  // Single-file greps (path given) have no file prefix; treat as one file.
  if (order.length === 1 || order.every((f) => f === '')) {
    if (lines.length <= cfg.grep.maxPerFile * 3) return null;
    const keep = lines.slice(0, cfg.grep.maxPerFile * 2);
    return [...keep, `… ${lines.length - keep.length} more matching lines …`].join('\n');
  }
  const out = [];
  let filesShown = 0;
  let hiddenFiles = 0;
  let hiddenMatches = 0;
  for (const f of order) {
    const ls = byFile.get(f);
    if (filesShown >= cfg.grep.maxFiles) {
      hiddenFiles++;
      hiddenMatches += ls.length;
      continue;
    }
    filesShown++;
    out.push(...ls.slice(0, cfg.grep.maxPerFile));
    if (ls.length > cfg.grep.maxPerFile) out.push(`${f}: … ${ls.length - cfg.grep.maxPerFile} more matches in this file …`);
  }
  if (hiddenFiles) out.push(`… ${hiddenMatches} matches in ${hiddenFiles} more files …`);
  return out.length < lines.length ? out.join('\n') : null;
}

