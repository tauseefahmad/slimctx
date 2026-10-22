---
description: Measure what loads into context before your first message (CLAUDE.md, imports, memory, skills)
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/bin/slimctx.mjs" audit`

Show the table above. Then name at most three concrete cuts for the largest files (what to move out, and where), without editing anything unless the user asks.
