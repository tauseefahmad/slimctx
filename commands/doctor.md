---
description: Check slimctx setup and list hook errors from the last 7 days
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/bin/slimctx.mjs" doctor`

Show the report above. If there are errors, say which hook and command triggered them and suggest opening an issue at https://github.com/tauseefahmad/slimctx/issues with the error line.
