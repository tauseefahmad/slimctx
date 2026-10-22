// Test-runner output: passing tests carry no information once the summary
// line says how many passed. Keep failures, their stack/diff blocks, and the
// summary; drop per-test "ok" lines. Detection is by content, so it works
// behind npm scripts, make targets and wrappers.

const PASS_LINE = [
  /^\s*(✓|√|✔)\s/, // jest, vitest, mocha, node:test spec reporter
  /^\s*PASS\s+\S/, // jest file header
  /^\s*ok \d+ - /, // TAP / node:test
  /^\s*# Subtest: /, // node:test TAP
  /^\s*---$|^\s*duration_ms: [\d.]+$|^\s*\.\.\.$|^\s*type: '(test|suite)'$/, // node:test TAP yaml for passes
  /^=== (RUN|PAUSE|CONT)\s/, // go test -v
  /^\s*--- PASS: /, // go test -v
  /^test \S.* \.\.\. ok$/, // cargo test
  /^.+::\S+ PASSED(\s+\[\s*\d+%\])?$/, // pytest -v
  /^\S+\.py \.+\s+\[\s*\d+%\]$/, // pytest progress, all dots
  /^\s*Passed\s+\S+/, // dotnet test -v
  /^\[INFO\] Tests run: \d+, Failures: 0, Errors: 0, Skipped: \d+, Time elapsed/, // surefire per class
  /^\[INFO\] Running \S+$/,
];

const RUNNER_HINT =
  /\b(test|tests|spec|jest|vitest|pytest|mocha|ava|tap|cargo test|go test|ctest|phpunit|rspec|surefire|dotnet test|node --test)\b/i;

const SUMMARY =
  /^(Tests?:|Test Suites:|Test Files|Tests\s+\d|# (tests|pass|fail|suites|cancelled|skipped|todo|duration_ms) |test result:|=+ .*(passed|failed|error).* =+$|ok\s+\S+\s+[\d.]+s|FAIL|PASS|Ran \d+ tests?|OK( \(|$)|FAILED \(|\[INFO\] Tests run:|\[ERROR\] Tests run:|Passed!|Failed!|Total tests:)/;

export function looksLikeTests(command, lines) {
  if (RUNNER_HINT.test(command || '')) return true;
  let pass = 0;
  for (const l of lines) if (PASS_LINE.some((re) => re.test(l))) pass++;
  return pass >= 5 && lines.some((l) => SUMMARY.test(l.trim()));
}

export function dropPassing(lines) {
  let dropped = 0;
  const out = [];
  for (const l of lines) {
    if (PASS_LINE.some((re) => re.test(l))) {
      dropped++;
      continue;
    }
    out.push(l);
  }
  // Too few to be worth the note, or nothing left: leave it alone.
  if (dropped < 5 || out.every((l) => !l.trim())) return { lines, dropped: 0 };
  return { lines: [`[slimctx: ${dropped} passing-test lines dropped]`, ...out], dropped };
}
