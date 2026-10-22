# slimctx: reduce Claude Code and Codex token usage

[![tests](https://github.com/tauseefahmad/slimctx/actions/workflows/test.yml/badge.svg)](https://github.com/tauseefahmad/slimctx/actions/workflows/test.yml)
[![release](https://img.shields.io/github/v/release/tauseefahmad/slimctx)](https://github.com/tauseefahmad/slimctx/releases)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**slimctx** is a free, open-source plugin for **Claude Code** and **OpenAI Codex CLI** that lowers token usage and cost. It condenses tool output (git, tests, builds, installs, logs, JSON, file lists, grep) before the model reads it. Measured on a real repository, it cut **82% of tool-output tokens**. Nothing is lost: every condensed output keeps its untouched original on disk, and the footer gives the path, so the agent can read it back.

Node ≥ 18, no other dependencies, no binary, no proxy, no network, no telemetry. It works alongside [rtk](https://github.com/rtk-ai/rtk) and [caveman](https://github.com/JuliusBrussee/caveman), or replaces them.

```bash
claude plugin marketplace add tauseefahmad/slimctx
```

```bash
claude plugin install slimctx@slimctx
```

## What it does

| Layer | Claude Code | Codex |
|---|---|---|
| **Condense command output after it runs.** Removes ANSI codes and progress bars, collapses repeated and near-identical lines, drops passing tests and download chatter, reshapes `git status`/`log`/`diff` and `ls -l`, condenses JSON, and cuts long output to head + tail while keeping error lines from the middle | `PostToolUse` → `updatedToolOutput` (Bash, PowerShell) | `PostToolUse` → `decision: block` + condensed text (replaces the result; the command is not undone) |
| **Failing commands too.** Claude Code fires `PostToolUseFailure` for a non-zero exit, and that event can't rewrite output. So a narrow `PreToolUse` wraps simple test/build/install commands in `slimctx run`, which keeps the exit code | `PreToolUse` `updatedInput` (auto; turns itself off when rtk/squeez is installed) | not needed: Codex `PostToolUse` also fires on non-zero exits |
| **Lossless recovery.** The full original is saved and the footer names the file. The model reads it with Read/grep; there is no MCP server to install | ✓ | ✓ |
| **Cross-call dedup.** Identical output seen again (a still-failing test, polling) becomes a one-line pointer | ✓ | ✓ |
| **Grep/Glob caps.** Per-file match caps; long file lists keep the first 120 and a count per directory | `PostToolUse` | n/a (Codex has no such tools) |
| **Outline-first reads.** A whole-file Read of a code/markdown file ≥ 600 lines returns a symbol outline with line numbers. Repeating the same Read gets the full file | `PreToolUse` deny + reason | n/a |
| **Short reply rules.** `lite` (default, ~60 tokens) or `full`, with automatic plain language for warnings and destructive steps | `SessionStart` | `SessionStart` |
| **Net-win guard.** Output passes through untouched unless the rewrite saves ≥ 80 tokens **and** ≥ 25% | ✓ | ✓ |
| **`gain` / `audit`.** Savings report; what loads before your first message | `/slimctx:gain`, `/slimctx:audit` | `slimctx gain`, `slimctx audit` |

## Benchmark: slimctx vs rtk on real output

`node bench/bench.mjs <repo>` runs each command raw, through `rtk`, and through slimctx's compressor. Counts are estimated tokens. Results below are from a real open-source repository ([career-ops](https://github.com/santifer/career-ops)):

| command | raw | rtk | slimctx | rtk cut | slimctx cut |
|---|---:|---:|---:|---:|---:|
| `git log -40` | 16,526 | 4,229 | 1,835 | 74% | 89% |
| `git status` | 275 | 147 | 213 | 47% | 23% |
| `git diff HEAD~3` | 50,456 | 11,719 | 4,995 | 77% | 90% |
| `git show HEAD~1` | 4,305 | 2,464 | 3,679 | 43% | 15% |
| `npm ls --all` | 114 | 114 | 114 | 0% | 0% |
| `ls -la` | 6,628 | 2,550 | 642 | 62% | 90% |
| `find . -name "*.mjs"` | 24,339 | — | 1,420 | n/a | 94% |
| `gh api …/issues?per_page=20` (JSON) | 42,417 | 42,417 | 13,929 | 0% | 67% |
| `node --test <file>` (all passing) | 238 | 239 | 47 | 0% | 80% |
| **total** | **145,298** | | **26,874** | | **82%** |

**Replay on real history.** 339 real Bash results from a month of Claude Code transcripts were replayed through the hook: 0 errors. The saving was only **3%**, for two reasons. First, rtk was already filtering those sessions, so their output was already small. Second, most of the large outputs were deliberate file reads (`cat`, `sed -n`, `head`), and slimctx leaves those alone on purpose. If you already run rtk, slimctx's Bash compression adds little. Its value is everything rtk lacks: recoverable originals, Grep/Glob caps, outline-first reads, dedup, Codex coverage, and the reply-style rules.

What the numbers don't show: rtk's figure for a command is what rtk *prints*, and that output is already lossy. slimctx's footer lets the model fetch anything that was cut. Look at the per-command rows, not just the total. A command whose output is already compact (e.g. `npm ls` on a small tree) is passed through, because rewriting it would cost more than it saves.

## Install

### Claude Code

```bash
claude plugin marketplace add tauseefahmad/slimctx
```

```bash
claude plugin install slimctx@slimctx
```

Restart Claude Code. Check with `/slimctx:gain` after some work.

**If you also use rtk:** both can run at once. rtk rewrites commands *before* they run, and slimctx condenses whatever comes back *after*, so rtk output that's already small passes through. slimctx's own pre-run wrapping turns itself off when it finds `rtk hook` in your settings, because two `updatedInput` hooks on the same call race. If you want slimctx alone, remove the `rtk hook claude` entry from `~/.claude/settings.json`.

### Codex

Codex reads `.codex-plugin/plugin.json` and `hooks/codex-hooks.json`:

```bash
codex plugin marketplace add tauseefahmad/slimctx
```

Then enable `slimctx` in `/plugins` and trust its hooks in `/hooks`. Codex skips plugin hooks until you review them.

### Anything else (Gemini CLI, Cursor, Copilot CLI, plain shell)

```bash
npx github:tauseefahmad/slimctx run -- npm test
```

Or pipe any text through `slimctx compress --cmd "git log"`.

## Commands and config

```
slimctx run -- <cmd...>        run, condense, keep exit code
slimctx compress [--cmd C]     condense stdin
slimctx gain [--days N] [--json]
slimctx audit
slimctx terse off|lite|full
slimctx config [key value]     e.g. slimctx config outline.minLines 1000
```

User config is stored at `<plugin data dir>/config.json` (`~/.slimctx/config.json` outside a plugin). A per-project override goes in `.slimctx.json` in the repo root. Set `SLIMCTX_DISABLE=1` to turn everything off for one run. Add `# slimctx:raw` to any command to get its output untouched. Defaults are in [lib/config.mjs](lib/config.mjs).

## Claude Code token-saving tools compared (Oct 2026)

| Project | ★ | Mechanism | What slimctx takes | What slimctx does differently |
|---|---|---|---|---|
| [rtk-ai/rtk](https://github.com/rtk-ai/rtk) | 84k | Rust proxy. A `PreToolUse` hook rewrites `git status` → `rtk git status`; 100+ per-command filters | per-command filters (git, tests, installs), grouping, dedup | Condenses *after* the command runs, so any command benefits, not only the 100 known ones. Permission rules stay matched against your real command. No binary, nothing to keep on PATH. Originals are kept |
| [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | 114k | Skill that makes replies telegraphic (~65% fewer output tokens claimed; the project measured 33% per session); optional cloud routing | answer-first, keep code/paths/errors exact, plain language for warnings | Rules cut to ~60 tokens (caveman's own notes say its ~1.2k tokens of rules can cancel the saving on short turns). Nothing leaves the machine |
| [headroomlabs-ai/headroom](https://github.com/headroomlabs-ai/headroom) | 77k | Local proxy + ML/AST compressors; CCR reversible retrieval | reversible compression, JSON array crushing (head/tail/error items + key list) | No proxy, no Python/ONNX, telemetry off by design. Recovery is a plain file the model Reads |
| [claudioemmanuel/squeez](https://github.com/claudioemmanuel/squeez) | 0.2k | Rust hooks for 7 hosts; `PostToolUse` rewrite of Read/Grep/Glob; MinHash dedup; retrieve tool | post-hoc rewriting, cross-call dedup, net-win threshold | Exact-hash dedup only (no fuzzy merging of outputs that differ); Node only; covers Bash *success and failure* on Claude Code |
| [tirth8205/code-review-graph](https://github.com/tirth8205/code-review-graph), [oraios/serena](https://github.com/oraios/serena), [zilliztech/claude-context](https://github.com/zilliztech/claude-context) | 32k / 31k / 13k | Code graph / LSP / vector search over MCP so the agent reads less | "read less" idea | Outline-first Read needs no index and no MCP. Use these alongside slimctx for big monorepos |
| [drona23/claude-token-efficient](https://github.com/drona23/claude-token-efficient) | 6k | One short CLAUDE.md of style rules | its finding that modern models already skip preamble, so long rule files only add input cost | Rules are short and injected once per session |
| [nadimtuhin/claude-token-optimizer](https://github.com/nadimtuhin/claude-token-optimizer) | 0.6k | Measures/shrinks startup context (CLAUDE.md etc.) | startup measurement | `slimctx audit` measures it and follows `@imports`, but never rewrites your files |
| [yvgude/lean-ctx](https://github.com/yvgude/lean-ctx), [anvanster/compressor](https://github.com/anvanster/compressor), [microsoft/LLMLingua](https://github.com/microsoft/LLMLingua), [toon-format/toon](https://github.com/toon-format/toon) | | shell hooks / instruction packs / learned prompt compression / compact JSON | | LLMLingua-style learned compression of your prompts was left out on purpose: caveman cites research showing it hurts answer quality |

The facts these choices rest on (checked against the docs on 2026-10-22):

- Claude Code `PostToolUse` `updatedToolOutput` works for every tool, if the value matches the tool's output shape (Bash: `{stdout, stderr, interrupted, isImage, …}`).
- A Bash command that exits non-zero fires `PostToolUseFailure`, which can only add context. That is the reason for the pre-run wrapper.
- Codex `PostToolUse` has no output rewrite, but `decision: "block"` "replaces the tool result with that feedback" and the turn continues. It fires on non-zero exits too.

## Limits (honest list)

- Explicit reads (`cat`, `sed -n`, `head`, `tail`, `jq`, …) are never condensed: the model asked for those bytes.
- Token counts are estimates from a word/punctuation heuristic, not a real tokenizer, so compare relative numbers.
- Condensing only changes what the model sees. The command has already run, and OpenTelemetry/analytics still record the original.
- Claude Code: the pre-run wrapper only touches simple commands (no pipes, `;`, `&&` except a leading `cd x &&`, redirects or `$()`), so a failing `npm test | tail` still reaches the model raw. A wrapped command's output is captured, not streamed, and a timeout kills it before anything is printed.
- Outline-first costs one extra round trip when the model really needs the whole file. Raise `outline.minLines`, or set `outline.enabled` to false, if that bothers you.
- Codex: the condensed result arrives through a "block" decision. The text says the command ran normally, but some models may still mention it.
- Agent/subagent return values, MCP tool output and your own prompts are not touched.

## FAQ

**How do I reduce Claude Code token usage?**
Most tokens in a coding session are tool output: test logs, `git diff`, installs, search results, whole-file reads. Install slimctx so that output is condensed before Claude reads it, keep CLAUDE.md short (`/slimctx:audit` shows what loads at startup), and `/clear` between unrelated tasks.

**Does it work with OpenAI Codex CLI?**
Yes. The same repository is a Codex plugin (`.codex-plugin/plugin.json`). Codex hooks condense Bash output, including commands that exit non-zero.

**Will Claude miss something important?**
Error-looking lines are always kept. Explicit file reads (`cat`, `sed -n`, `head`) are never touched, and every cut output has its full original saved, with the path in the footer. Add `# slimctx:raw` to any command to see it untouched.

**How is this different from rtk or caveman?**
rtk rewrites known commands before they run. caveman shortens Claude's replies. slimctx condenses the output of *any* command after it runs, keeps the original recoverable, also covers Grep, Glob, large file reads and Codex, and ships a ~60-token reply style. You can run it next to either one.

**Does it send my code anywhere?**
No. Everything runs locally in Node. There is no network access and no telemetry.

**How much does it save?**
On the benchmark above, 82% of tool-output tokens. In a session that is mostly file reads, much less. `/slimctx:gain` reports your own numbers.

## Develop

```bash
node --test test/slimctx.test.mjs
```

```bash
node bench/bench.mjs /path/to/repo
```

MIT licensed.
