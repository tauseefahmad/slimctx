// Command-agnostic passes. Every pass is conservative: it only removes what
// can be described in one line ("×12", "… 40 similar lines …"), and lines
// that look like errors always survive truncation.
import { isImportant, lineShape } from '../text.mjs';

export function collapseBlank(lines) {
  const out = [];
  for (const l of lines) {
    if (l.trim() === '' && (out.length === 0 || out[out.length - 1].trim() === '')) continue;
    out.push(l);
  }
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out;
}

export function collapseExactRuns(lines) {
  const out = [];
  let i = 0;
  let saved = 0;
  while (i < lines.length) {
    let j = i + 1;
    while (j < lines.length && lines[j] === lines[i]) j++;
    const n = j - i;
    if (n >= 3 && lines[i].trim()) {
      out.push(`${lines[i]}  [×${n}]`);
      saved += n - 1;
    } else {
      for (let k = i; k < j; k++) out.push(lines[k]);
    }
    i = j;
  }
  return { lines: out, saved };
}

// Runs of lines that differ only in numbers/hashes (log spam, per-item
// progress, timestamps) keep their first and last member.
export function collapseSimilarRuns(lines, minRun = 4) {
  const out = [];
  let i = 0;
  let saved = 0;
  while (i < lines.length) {
    const shape = lineShape(lines[i]);
    let j = i + 1;
    if (shape.length > 3) {
      while (j < lines.length && lineShape(lines[j]) === shape) j++;
    }
    const n = j - i;
    if (n >= minRun && !lines.slice(i, j).some(isImportant)) {
      out.push(lines[i], `  … ${n - 2} similar lines …`, lines[j - 1]);
      saved += n - 2;
    } else {
      for (let k = i; k < j; k++) out.push(lines[k]);
    }
    i = j;
  }
  return { lines: out, saved };
}

// Head + tail, plus error-looking lines (with one line of context) from the
// middle, so a failure buried in line 900 of 2000 still reaches the model.
export function truncate(lines, cfg) {
  if (lines.length <= cfg.maxLines) return { lines, omitted: 0 };
  const head = lines.slice(0, cfg.headLines);
  const tail = lines.slice(lines.length - cfg.tailLines);
  const mid = lines.slice(cfg.headLines, lines.length - cfg.tailLines);
  const keep = new Set();
  for (let i = 0; i < mid.length && keep.size < cfg.importantLines; i++) {
    if (isImportant(mid[i])) {
      if (i > 0) keep.add(i - 1);
      keep.add(i);
      if (i + 1 < mid.length) keep.add(i + 1);
    }
  }
  // Sectioned output (an unindented header over indented children): keep the
  // middle's headers so the model still sees every section exists.
  const headers = [];
  for (let i = 0; i < mid.length; i++) if (/^\S/.test(mid[i])) headers.push(i);
  const indented = mid.filter((l) => /^\s+\S/.test(l)).length;
  if (headers.length >= 2 && headers.length <= cfg.importantLines && headers.length * 4 <= mid.length && indented >= mid.length / 2) {
    for (const i of headers) keep.add(i);
  }
  const out = [...head];
  let gap = 0;
  let omitted = 0;
  const flush = () => {
    if (gap) out.push(`  … ${gap} lines omitted …`);
    omitted += gap;
    gap = 0;
  };
  for (let i = 0; i < mid.length; i++) {
    if (keep.has(i)) {
      flush();
      out.push(mid[i]);
    } else gap++;
  }
  flush();
  out.push(...tail);
  return { lines: out, omitted };
}
