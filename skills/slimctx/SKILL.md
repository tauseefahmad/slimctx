---
name: slimctx
description: How to work with slimctx-condensed tool output — recovering omitted lines from the stashed original, bypassing compression for one command, running noisy commands through `slimctx run`, and checking savings. Use when output shows "[slimctx: …]" or "… N lines omitted …", or the user asks about token savings.
---

# slimctx

Tool output in this session may be condensed. Nothing is deleted: the full original is saved and its path is in the footer.

- `[slimctx: ~A→B tokens (est.) via passes · full output: PATH]` closes every condensed output. To see what was cut, Read PATH (use offset/limit) or grep it. Do not re-run the command just to see more.
- `… N lines omitted …`, `… N similar lines …`, `[×N]`, `… N progress/download lines …`, `[slimctx: N passing-test lines dropped]` mark what was removed. Error-looking lines in the middle of long output are always kept.
- `[slimctx: identical to the output of … at HH:MM:SS — nothing changed.]` means the command produced byte-identical output again.
- A whole-file Read of a big code file may come back as an outline with line numbers. Read the ranges you need with offset/limit, or repeat the same Read to get the full file.
- Append the comment `# slimctx:raw` to a Bash command to get its output untouched.
- On hosts without hooks, run noisy commands as `node <plugin>/bin/slimctx.mjs run -- <command>`; the exit code is preserved.
- Savings: `node <plugin>/bin/slimctx.mjs gain`. Startup context size: `... audit`.
