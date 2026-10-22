// git porcelain output. Only reshapes the default human formats; any
// explicit --format/--pretty/--porcelain means the caller chose the shape,
// so it is left alone.

export function gitSubcommand(command) {
  // Skip `cd x &&`, env assignments, `rtk`, and global flags like -C <dir>.
  const m = String(command || '').match(
    /(?:^|&&|;|\|\|)\s*(?:[A-Z_]+=\S+\s+)*(?:rtk\s+)?git\s+((?:-[cC]\s+\S+\s+|--\S+\s+)*)([a-z-]+)([^|;&]*)/
  );
  return m ? { sub: m[2], args: m[3] || '' } : null;
}

const CUSTOM_SHAPE = /--(format|pretty|porcelain|oneline|name-only|name-status|numstat|shortstat|stat|raw|patch)\b|\s-p\b|\s-s\b|--short\b/;

export function gitStatus(lines) {
  let saved = 0;
  const out = [];
  let section = null;
  let untracked = [];
  const flushUntracked = () => {
    if (untracked.length > 15) {
      // Root-level entries stay as they are; deeper ones group by top dir.
      const byDir = new Map();
      const before = out.length;
      for (const f of untracked) {
        const p = f.trim();
        const slash = p.indexOf('/');
        if (slash < 0 || slash === p.length - 1) out.push(f);
        else byDir.set(p.slice(0, slash + 1), (byDir.get(p.slice(0, slash + 1)) || 0) + 1);
      }
      for (const [dir, n] of byDir) out.push(`\t${dir} (${n} files)`);
      saved += untracked.length - (out.length - before);
    } else out.push(...untracked);
    untracked = [];
  };
  for (const l of lines) {
    if (/^\s+\((use|commit or discard|fix conflicts|all conflicts)\b.*\)$/.test(l)) {
      saved++;
      continue;
    }
    if (/^Untracked files:/.test(l)) section = 'u';
    else if (/^\S/.test(l) || l.trim() === '') {
      if (section === 'u') flushUntracked();
      section = null;
    }
    if (section === 'u' && /^\t/.test(l)) untracked.push(l);
    else out.push(l);
  }
  if (section === 'u') flushUntracked();
  return { lines: out, saved };
}

// Default `git log` → one line per commit: hash, subject, author, date.
export function gitLog(lines) {
  const commits = [];
  let cur = null;
  for (const l of lines) {
    const m = l.match(/^commit ([0-9a-f]{7,40})(.*)$/);
    if (m) {
      cur = { hash: m[1].slice(0, 9), refs: m[2].trim(), author: '', date: '', subject: null };
      commits.push(cur);
      continue;
    }
    if (!cur) return null; // not default format
    const a = l.match(/^Author:\s+(.*?)\s*(<.*>)?$/);
    if (a) { cur.author = a[1]; continue; }
    const d = l.match(/^(Date|AuthorDate):\s+(.*)$/);
    if (d) { cur.date = d[2].trim(); continue; }
    if (/^Merge: /.test(l)) continue;
    if (cur.subject === null && l.trim()) cur.subject = l.trim();
  }
  if (commits.length < 4) return null;
  const out = commits.map(
    (c) => `${c.hash} ${c.subject || ''}${c.refs ? ' ' + c.refs : ''} — ${c.author}, ${c.date}`
  );
  return { lines: out, saved: lines.length - out.length };
}

const LOCKFILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|go\.sum|gradle\.lockfile|packages\.lock\.json)$/;

// Diffs: drop `index abc..def` lines, and summarise lockfile / minified /
// generated file sections instead of printing thousands of lines of them.
export function gitDiff(lines, budget = 400) {
  const out = [];
  let saved = 0;
  let i = 0;
  // Spread the line budget across files so a big diff shows every file's
  // first hunks instead of the first file in full and nothing after it.
  const nFiles = lines.filter((l) => l.startsWith('diff --git ')).length || 1;
  const perFile = Math.max(25, Math.floor(budget / nFiles));
  while (i < lines.length) {
    const l = lines[i];
    const m = l.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (!m) {
      if (/^index [0-9a-f]+\.\.[0-9a-f]+/.test(l)) { saved++; i++; continue; }
      out.push(l);
      i++;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && !/^diff --git /.test(lines[j])) j++;
    const body = lines.slice(i + 1, j);
    const file = m[2];
    const add = body.filter((x) => x.startsWith('+') && !x.startsWith('+++')).length;
    const del = body.filter((x) => x.startsWith('-') && !x.startsWith('---')).length;
    const minified = body.some((x) => x.length > 1000);
    if ((LOCKFILE.test(file) || minified || /\.(min\.(js|css)|map|snap)$/.test(file)) && body.length > 20) {
      out.push(l, `  [slimctx: ${LOCKFILE.test(file) ? 'lockfile' : 'generated/minified'} diff summarised: +${add} -${del} lines]`);
      saved += body.length - 1;
    } else {
      out.push(l);
      const kept = body.filter((b) => !/^index [0-9a-f]+\.\.[0-9a-f]+/.test(b));
      saved += body.length - kept.length;
      if (kept.length > perFile) {
        // Cut at a hunk boundary when one is near, so no hunk is half shown.
        let cut = perFile;
        for (let k = perFile; k > perFile * 0.6; k--) if (kept[k].startsWith('@@')) { cut = k; break; }
        const rest = kept.slice(cut);
        const hunks = rest.filter((x) => x.startsWith('@@')).length;
        out.push(...kept.slice(0, cut), `  [slimctx: ${rest.length} more diff lines in ${file} (${hunks} more hunks, +${rest.filter((x) => x.startsWith('+')).length} -${rest.filter((x) => x.startsWith('-')).length})]`);
        saved += rest.length - 1;
      } else out.push(...kept);
    }
    i = j;
  }
  return { lines: out, saved };
}

export function applyGit(command, lines) {
  const g = gitSubcommand(command);
  if (!g) return null;
  if (g.sub === 'status' && !CUSTOM_SHAPE.test(' ' + g.args)) return gitStatus(lines);
  if (g.sub === 'log' && !CUSTOM_SHAPE.test(' ' + g.args) && !/--graph/.test(g.args)) return gitLog(lines);
  if (['diff', 'show'].includes(g.sub) || (g.sub === 'log' && /\s-p\b|--patch/.test(' ' + g.args))) return gitDiff(lines);
  return null;
}
