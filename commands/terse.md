---
description: Set reply style rules — off, lite (default) or full
argument-hint: off|lite|full
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/bin/slimctx.mjs" terse $ARGUMENTS`

Confirm the new level in one line. Apply it from now on in this session too: lite = answer first, no preamble or recap; full = also drop filler and articles, fragments fine; off = normal style.
