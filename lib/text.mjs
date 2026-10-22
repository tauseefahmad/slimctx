// Text primitives shared by every filter: token estimate, ANSI/CR cleanup,
// line normalisation for near-duplicate detection.

// BPE tokenizers split code into word pieces and nearly every punctuation
// mark becomes its own token, so bytes/4 badly undercounts symbol-heavy
// output (diffs, JSON, stack traces). Words cost ~1 token per 4 chars,
// punctuation 1 each. Still an estimate; it is labelled as one everywhere.
export function estimateTokens(s) {
  if (!s) return 0;
  let n = 0;
  for (const m of s.matchAll(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g)) {
    const t = m[0];
    n += t.length > 1 && /\w/.test(t[0]) ? Math.ceil(t.length / 4) : 1;
  }
  return n;
}

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export function stripAnsi(s) {
  return s.replace(ANSI, '');
}

// A progress bar redraws one line with \r; only the last frame is real.
export function resolveCarriageReturns(s) {
  if (!s.includes('\r')) return s;
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) return line;
      const frames = line.split('\r').filter((f) => f.length);
      return frames.length ? frames[frames.length - 1] : '';
    })
    .join('\n');
}

export function clean(s) {
  return resolveCarriageReturns(stripAnsi(s)).replace(/[ \t]+$/gm, '');
}

// Shape of a line with its volatile parts (numbers, hashes, ids, times,
// paths' numeric segments) masked, so "Downloaded foo 1.2.3 (34 kB)" and
// "Downloaded bar 4.5.6 (2 MB)" compare equal-ish.
export function lineShape(line) {
  return line
    .replace(/\b[0-9a-f]{7,64}\b/gi, '#')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '#')
    .replace(/\d+(\.\d+)*/g, '0')
    .replace(/\s+/g, ' ')
    .trim();
}

// Words of the line after its leading token, used to tell "same kind of
// line" (shape match) from "same line with different payload".
export function firstWord(line) {
  const m = line.trim().match(/^\S+/);
  return m ? m[0] : '';
}

export const IMPORTANT =
  /\b(error|errors|err!|fail(ed|ure|ing)?|fatal|panic(ked)?|exception|traceback|assert(ion)?(error)?|warn(ing)?|denied|refused|not found|cannot|can't|unable|undefined|segfault|timed? ?out|exit code|abort(ed)?)\b|✗|✖|×|❌|⚠|^E\s|^\s*at\s.+:\d+/i;

export function isImportant(line) {
  return IMPORTANT.test(line);
}

export function splitLines(s) {
  if (!s) return [];
  const lines = s.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
