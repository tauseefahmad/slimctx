// File listings: `ls -l` drops the permission/owner/date columns the model
// rarely needs (dirs get a trailing slash, files keep their size); long path
// lists from find/fd/git ls-files keep their head and a per-directory count.

// Keep the first N paths, summarise the rest by directory.
export function compressPathList(paths, max) {
  if (paths.length <= max) return null;
  const keep = paths.slice(0, max);
  const rest = paths.slice(max);
  const byDir = new Map();
  for (const p of rest) {
    const norm = p.replace(/\\/g, '/');
    const d = norm.includes('/') ? norm.slice(0, norm.lastIndexOf('/')) : '.';
    byDir.set(d, (byDir.get(d) || 0) + 1);
  }
  const summary = [...byDir.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([d, n]) => `… ${n} more in ${d}/`);
  if (byDir.size > 15) summary.push(`… and ${byDir.size - 15} more directories`);
  return [...keep, ...summary];
}

const LS_LONG =
  /^([-dlcbps])[rwxsStT-]{9}[@+.]?\s+\d+\s+\S+\s+\S+\s+([\d,.]+[KMGTP]?)\s+(?:\w{3}\s+\d+\s+[\d:]+|\d{4}-\d\d-\d\d[\sT][\d:.]+(?:\s+[+-]\d{4})?)\s+(.+)$/;

export function lsLong(lines) {
  const body = lines.filter((l) => l.trim() && !/^total \d+/.test(l));
  const hits = body.filter((l) => LS_LONG.test(l)).length;
  if (body.length < 12 || hits / body.length < 0.7) return null;
  const out = [];
  for (const l of lines) {
    if (/^total \d+/.test(l)) continue;
    const m = l.match(LS_LONG);
    if (!m) {
      out.push(l);
      continue;
    }
    const [, type, size, name] = m;
    if (name === '.' || name === '..') continue;
    out.push(type === 'd' ? `${name}/` : type === 'l' ? name : `${name}  ${size}`);
  }
  return out;
}

const PATHISH = /^(?:\.{0,2}[\\/]|[A-Za-z]:[\\/]|[\w@.-]+[\\/])[^:\t]*$|^[\w@.-]+\.[A-Za-z0-9]{1,8}$/;

export function pathList(lines, max) {
  const body = lines.filter((l) => l.trim());
  if (body.length <= max) return null;
  if (body.filter((l) => PATHISH.test(l.trim())).length / body.length < 0.9) return null;
  return compressPathList(body.map((l) => l.trim()), max);
}
