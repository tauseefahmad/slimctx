// Synthetic but realistic tool outputs, generated so the tests stay small.
const range = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('\n');

export const npmInstall = [
  ...Array.from({ length: 40 }, (_, i) => `npm http fetch GET 200 https://registry.npmjs.org/pkg-${i} ${10 + i}ms (cache miss)`),
  'npm WARN deprecated inflight@1.0.6: This module is not supported',
  'npm WARN deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported',
  ...Array.from({ length: 30 }, (_, i) => `npm timing reifyNode:node_modules/pkg-${i} Completed in ${i * 3}ms`),
  '',
  'added 412 packages, and audited 413 packages in 9s',
  '',
  '58 packages are looking for funding',
  '  run `npm fund` for details',
  '',
  'found 0 vulnerabilities',
].join('\n');

export const jestFail = [
  'PASS src/a.test.js',
  ...Array.from({ length: 60 }, (_, i) => `  ✓ handles case ${i} (${i % 7} ms)`),
  'FAIL src/b.test.js',
  '  ● parser › rejects bad input',
  '',
  '    expect(received).toThrow()',
  '',
  '    Received function did not throw',
  '',
  '      12 |   it("rejects bad input", () => {',
  '    > 13 |     expect(() => parse("{")).toThrow();',
  '         |                              ^',
  '      at Object.<anonymous> (src/b.test.js:13:30)',
  '',
  ...Array.from({ length: 30 }, (_, i) => `  ✓ other case ${i} (1 ms)`),
  '',
  'Test Suites: 1 failed, 1 passed, 2 total',
  'Tests:       1 failed, 90 passed, 91 total',
  'Time:        2.31 s',
].join('\n');

export const goTest = [
  ...Array.from({ length: 50 }, (_, i) => `=== RUN   TestThing${i}\n--- PASS: TestThing${i} (0.00s)`),
  '=== RUN   TestBroken',
  '    broken_test.go:22: got 3, want 4',
  '--- FAIL: TestBroken (0.00s)',
  'FAIL',
  'FAIL\texample.com/pkg\t0.412s',
].join('\n');

export const gitLog = range(
  12,
  (i) => `commit ${'a1b2c3d4e5f6'.repeat(3).slice(0, 36)}${String(i).padStart(4, '0')}\nAuthor: Dev Person <dev@example.com>\nDate:   Mon Oct ${10 + i} 12:00:00 2026 +0200\n\n    feat: change number ${i}\n\n    Longer body line one for ${i}.\n    Longer body line two.\n`
);

export const gitStatus = [
  'On branch main',
  "Your branch is up to date with 'origin/main'.",
  '',
  'Changes not staged for commit:',
  '  (use "git add <file>..." to update what will be committed)',
  '  (use "git restore <file>..." to discard changes in working directory)',
  '\tmodified:   src/index.js',
  '',
  'Untracked files:',
  '  (use "git add <file>..." to include in what will be committed)',
  ...Array.from({ length: 40 }, (_, i) => `\tbuild/out/chunk-${i}.js`),
  ...Array.from({ length: 10 }, (_, i) => `\tdocs/page-${i}.md`),
  '\tnotes.txt',
  '',
  'no changes added to commit (use "git add" and/or "git commit -a")',
].join('\n');

export const gitDiffLock = [
  'diff --git a/src/app.js b/src/app.js',
  'index 1111111..2222222 100644',
  '--- a/src/app.js',
  '+++ b/src/app.js',
  '@@ -1,3 +1,3 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  'diff --git a/package-lock.json b/package-lock.json',
  'index 3333333..4444444 100644',
  '--- a/package-lock.json',
  '+++ b/package-lock.json',
  ...Array.from({ length: 300 }, (_, i) => `${i % 2 ? '+' : '-'}      "integrity": "sha512-${'x'.repeat(40)}${i}",`),
].join('\n');

export const jsonArray = JSON.stringify(
  { total: 200, items: Array.from({ length: 200 }, (_, i) => ({ id: i, name: `item-${i}`, status: i === 137 ? 'error' : 'ok', tags: ['a', 'b'] })) },
  null,
  2
);

export const logSpam = [
  'server starting',
  ...Array.from({ length: 300 }, (_, i) => `2026-10-22T10:00:${String(i % 60).padStart(2, '0')}.${i}Z INFO request id=${1000 + i} path=/health took ${i % 9}ms`),
  '2026-10-22T10:05:00.000Z ERROR database connection refused (ECONNREFUSED 127.0.0.1:5432)',
  ...Array.from({ length: 300 }, (_, i) => `2026-10-22T10:06:${String(i % 60).padStart(2, '0')}.${i}Z INFO request id=${2000 + i} path=/health took ${i % 9}ms`),
  'server stopped',
].join('\n');

export const bigTs = [
  "import { x } from './x';",
  '',
  ...Array.from({ length: 40 }, (_, i) =>
    [`export function handler${i}(req: Request, res: Response) {`, ...Array.from({ length: 15 }, (_, j) => `  const v${j} = req.body.f${j} ?? ${j};`), '  return res.json({ ok: true });', '}', ''].join('\n')
  ),
  'export class Service {',
  '  constructor(private db: Db) {}',
  '  async findAll(limit: number): Promise<Row[]> {',
  '    return this.db.query(limit);',
  '  }',
  '}',
].join('\n');
