// Large JSON payloads (API responses, `gh ... --json`, kubectl -o json):
// long arrays keep their head, tail and any item that looks like an error,
// with a note giving the item count and the union of keys, so the model
// knows what exists and can ask for the rest. Idea from headroom's
// SmartCrusher, without the statistics or the ML.

const ERRORISH = /error|fail|exception|invalid|denied|unhealthy|crash/i;

function crush(v, budget, depth = 0) {
  if (Array.isArray(v)) {
    const items = v.map((x) => crush(x, budget, depth + 1));
    if (items.length <= budget.arrayKeep + 2) return items;
    const keepIdx = new Set([0, 1, 2, items.length - 1]);
    items.forEach((x, i) => {
      if (keepIdx.size < budget.arrayKeep + 6 && ERRORISH.test(JSON.stringify(x))) keepIdx.add(i);
    });
    const keys = new Set();
    for (const x of v) if (x && typeof x === 'object' && !Array.isArray(x)) Object.keys(x).forEach((k) => keys.add(k));
    const out = [];
    let skipped = 0;
    items.forEach((x, i) => {
      if (keepIdx.has(i)) {
        if (skipped) out.push(`… ${skipped} more items …`);
        skipped = 0;
        out.push(x);
      } else skipped++;
    });
    budget.notes.push(`array of ${items.length}${keys.size ? ` (keys: ${[...keys].slice(0, 25).join(', ')})` : ''}`);
    return out;
  }
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = crush(x, budget, depth + 1);
    return o;
  }
  if (typeof v === 'string' && v.length > budget.maxString) {
    return v.slice(0, budget.maxString) + `… [+${v.length - budget.maxString} chars]`;
  }
  return v;
}

export function compressJson(text) {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return null;
  let v;
  try {
    v = JSON.parse(t);
  } catch {
    return null;
  }
  const budget = { arrayKeep: 3, maxString: 400, notes: [] };
  const crushed = crush(v, budget);
  // Indentation is pure overhead for a model; one item per line keeps it
  // scannable without the whitespace.
  const body = JSON.stringify(crushed, null, 0);
  const note = budget.notes.length ? `[slimctx: JSON condensed — ${budget.notes.slice(0, 6).join('; ')}]\n` : '';
  return note + body;
}
