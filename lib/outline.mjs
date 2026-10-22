// Symbol outline of a source file by regex: cheap, dependency-free, good
// enough to pick which ranges to read. Not a parser — it is a map, and the
// model reads the real code with offset/limit afterwards.
import path from 'node:path';

const C_LIKE_SKIP = /^\s*(if|for|while|switch|catch|return|else|do|try|with|using|lock|foreach)\b/;

const LANGS = [
  {
    ext: /\.(m?[jt]sx?|cjs|cts|mts|vue|svelte)$/,
    re: [
      /^\s*(export\s+)?(default\s+)?(declare\s+)?(abstract\s+)?(async\s+)?(function\*?|class|interface|type|enum|namespace|module)\s+[\w$]/,
      /^(export\s+)?(const|let|var)\s+[\w$]+\s*(:\s*[^=]+)?=\s*(async\s*)?(\([^)]*\)|[\w$]+)\s*(:\s*[^=]+)?=>/,
      /^(export\s+)?(const|let|var)\s+[\w$]+\s*=\s*(async\s+)?function/,
      /^export\s+(const|let|var)\s+[\w$]+/,
      /^\s{2,4}(public\s+|private\s+|protected\s+|static\s+|async\s+|readonly\s+|get\s+|set\s+|override\s+)*#?[\w$]+\s*(<[^>]*>)?\([^)]*\)?\s*(:\s*[^{]+)?\{\s*$/,
      /^\s*(describe|it|test)(\.\w+)?\(\s*['"`]/,
    ],
  },
  { ext: /\.pyi?$/, re: [/^\s*(async\s+)?def\s+\w+/, /^\s*class\s+\w+/, /^[A-Z][A-Z0-9_]+\s*=/] },
  { ext: /\.go$/, re: [/^func\s/, /^type\s+\w+/, /^(var|const)\s+\(?\w*/] },
  { ext: /\.rs$/, re: [/^\s*(pub(\([\w:]+\))?\s+)?(async\s+)?(unsafe\s+)?(fn|struct|enum|trait|impl|mod|type|const|static|macro_rules!)\b/] },
  {
    ext: /\.(java|kt|kts|scala|cs|swift|dart)$/,
    re: [
      /^\s*(@\w+\s+)*(public|private|protected|internal|static|final|abstract|sealed|open|data|override|suspend|partial|async|virtual|inline|fun|func|class|interface|record|enum|object|struct|protocol|extension|init)\b[^;=]*[({]\s*$/,
      /^\s*(public|private|protected|internal)?\s*(static\s+)?(class|interface|record|enum|struct|object|protocol)\s+\w+/,
      /^\s*(fun|func)\s+\w+/,
    ],
  },
  { ext: /\.(rb|rake)$/, re: [/^\s*(def|class|module)\s+\S+/] },
  { ext: /\.php$/, re: [/^\s*((abstract|final|public|private|protected|static)\s+)*(function|class|interface|trait|enum)\s+\w+/] },
  { ext: /\.(c|h|cc|cpp|cxx|hpp|hh|m|mm)$/, re: [/^[A-Za-z_][\w\s\*&:<>,~]*\b[\w:~]+\s*\([^;]*\)\s*(const\s*)?\{?\s*$/, /^\s*(class|struct|namespace|enum|union|typedef)\s+\w+/, /^#define\s+\w+/] },
  { ext: /\.(sh|bash|zsh|ps1|psm1)$/, re: [/^\s*(function\s+[\w-]+|[\w-]+\s*\(\)\s*\{)/] },
  { ext: /\.(lua)$/, re: [/^\s*(local\s+)?function\s+[\w.:]+/] },
  { ext: /\.(ex|exs)$/, re: [/^\s*(defmodule|defp?|defmacro)\s+\S+/] },
  { ext: /\.(md|mdx|markdown|rst)$/, re: [/^#{1,6}\s+\S/] },
  { ext: /\.(sql)$/, re: [/^\s*(create|alter)\s+(or\s+replace\s+)?(table|view|function|procedure|index|trigger|type)\b/i] },
];

export function outlinable(file) {
  return LANGS.some((l) => l.ext.test(file.toLowerCase()));
}

export function outline(file, content, maxEntries = 160) {
  const lang = LANGS.find((l) => l.ext.test(file.toLowerCase()));
  if (!lang) return null;
  const lines = content.split('\n');
  let entries = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.length > 300 || C_LIKE_SKIP.test(l)) continue;
    if (lang.re.some((re) => re.test(l))) entries.push({ n: i + 1, text: l.replace(/\s*\{\s*$/, '').trimEnd(), indent: l.match(/^\s*/)[0].length });
  }
  // Too many symbols: keep the shallowest levels until it fits.
  while (entries.length > maxEntries) {
    const maxIndent = Math.max(...entries.map((e) => e.indent));
    if (maxIndent === 0) {
      entries = entries.slice(0, maxEntries);
      break;
    }
    entries = entries.filter((e) => e.indent < maxIndent);
  }
  return { totalLines: lines.length, entries, name: path.basename(file) };
}

export function renderOutline(file, o) {
  const width = String(o.totalLines).length;
  const body = o.entries.map((e) => `${String(e.n).padStart(width)}  ${e.text}`).join('\n');
  return [
    `slimctx outline-first: ${file} is ${o.totalLines} lines, so here is its symbol outline instead of the whole file.`,
    `Read only the ranges you need (Read with offset/limit). If you really need the whole file, repeat the exact same Read and it will go through.`,
    '',
    body || '(no symbols recognised)',
  ].join('\n');
}
