# Changelog

## 0.1.1 — 2026-10-24

- Test filter no longer drops PASS lines from a script's own report: the jest header pattern now needs a test file path, and quoted script bodies (python -c "...") no longer count as a test-runner hint
- Truncation keeps section headers from the omitted middle of sectioned output, so every section stays visible
- Release script no longer adds a co-author trailer

## 0.1.0 — 2026-10-22

- First release: post-run output condensing for Claude Code and Codex, lossless stash, cross-call dedup, Grep/Glob caps, outline-first reads, reply-style rules, gain/audit/doctor reports.
