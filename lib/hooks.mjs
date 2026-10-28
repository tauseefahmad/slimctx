// Hook handlers. Each takes the parsed hook payload and returns the JSON the
// host expects on stdout, or null for "no opinion". Any exception is caught
// by the caller and turns into a silent pass-through: a broken compressor
// must never break a tool call.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compressGrepContent, compressPathList, compressText, worthIt } from './compress.mjs';
import { loadConfig } from './config.mjs';
import { outline, outlinable, renderOutline } from './outline.mjs';
import { hash, isStashPath, loadSession, pruneStash, record, saveSession, stash } from './store.mjs';
import { sessionContext } from './terse.mjs';
import { clean, estimateTokens } from './text.mjs';

const RAW = /slimctx:raw/;
// The model asked for exactly these bytes (a file, a line range); cutting
// them would force a re-read. Searches get the per-file cap instead.
// rtk's hook rewrites cat/head/tail to `rtk read` and grep to `rtk grep` before
// PostToolUse sees the command, so both spellings count.
const READ_INTENT = /(?:^|[;&|]\s*|\$\(\s*|\bdo\s+)(?:rtk\s+read|cat|sed\s+-n|head|tail|nl|bat|less|more|type|Get-Content|gc|awk\s+'NR|jq|[Ss]elect(?:-[Oo]bject)?\s+-(?:[Ff]irst|[Ll]ast))\b/;
const SEARCH_INTENT = /(?:^|[;&|]\s*)(?:rtk\s+grep|grep|rg|ag|git\s+grep|findstr|Select-String)\b/;
const WRAPPED = /slimctx\.mjs"?\s+run\b/;

function bypassed(command, cfg) {
  if (!command) return false;
  if (RAW.test(command) || WRAPPED.test(command) || isStashPath(command)) return true;
  if (/[\\/]stash[\\/]/.test(command) && /slimctx/i.test(command)) return true;
  return (cfg.bypass || []).some((re) => {
    try { return new RegExp(re).test(command); } catch { return false; }
  });
}

function footer(m, passes, file) {
  return `[slimctx: ~${m.before.toLocaleString('en-US')}→${m.after.toLocaleString('en-US')} tokens (est.) via ${passes.join(',') || 'trim'}${file ? ` · full output: ${file}` : ''}]`;
}

// Shared by Claude PostToolUse(Bash), Codex PostToolUse and the `run`
// wrapper. Returns { text, meta } or null when the original should stand.
export function shrinkCommandOutput({ text, command, sessionId, cfg, tool = 'Bash', host = 'claude' }) {
  if (!text || text.length < 400) return null;
  if (READ_INTENT.test(String(command).replace(/"[^"]*"|'[^']*'/g, '""'))) return null;
  const state = loadSession(sessionId);
  state.calls = (state.calls || 0) + 1;
  const h = hash(clean(text));

  // Cross-call dedup: the same command producing byte-identical output
  // (re-running a still-failing test, polling a status) is answered with a
  // pointer instead of a second copy.
  const prev = (state.recent || []).find((r) => r.h === h);
  if (prev && estimateTokens(text) > 150) {
    const msg = `[slimctx: identical to the output of \`${prev.cmd.slice(0, 80)}\` at ${prev.at} — nothing changed.${prev.file ? ` Full output: ${prev.file}` : ''}]`;
    const m = worthIt(text, msg, { ...cfg, minSavedRatio: 0 });
    if (m) {
      saveSession(sessionId, state);
      record({ host, tool, cmd: command.slice(0, 120), before: m.before, after: m.after, passes: ['dedup-call'] });
      return { text: msg, meta: m };
    }
  }

  const { text: out, passes } = compressText(text, { command, cfg });
  const provisional = footer({ before: estimateTokens(text), after: estimateTokens(out) }, passes, 'x'.repeat(60));
  const m = worthIt(text, out, cfg, provisional);
  const remember = (file) => {
    state.recent = [{ h, cmd: command || tool, at: new Date().toTimeString().slice(0, 8), file }, ...(state.recent || [])].slice(0, cfg.dedupWindow);
    saveSession(sessionId, state);
  };
  if (!m) {
    remember(null);
    return null;
  }
  const file = cfg.stash ? stash(sessionId, text, command.split(/\s+/)[0] || tool) : null;
  remember(file);
  const final = `${out}\n${footer(m, passes, file)}`;
  record({ host, tool, cmd: command.slice(0, 120), before: m.before, after: estimateTokens(final), passes });
  return { text: final, meta: m };
}

// ---------- SessionStart (both hosts) ----------
export function onSessionStart(payload, host) {
  const cfg = loadConfig(payload.cwd);
  if (!cfg.enabled) return null;
  try { pruneStash(cfg.stashDays); } catch {}
  const ctx = sessionContext(cfg);
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx } };
}

// ---------- Claude Code PostToolUse ----------
export function onClaudePost(payload) {
  const cfg = loadConfig(payload.cwd);
  if (!cfg.enabled) return null;
  const { tool_name: tool, tool_input: input = {}, tool_response: resp, session_id: sid } = payload;
  if (!resp || typeof resp !== 'object') return null;
  let updated = null;

  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = input.command || '';
    if (bypassed(command, cfg)) return null;
    // Claude Code already spilled huge output to disk and shows a preview.
    if (resp.isImage || resp.persistedOutputPath || resp.backgroundTaskId) return null;
    const stdout = resp.stdout || '';
    const stderr = resp.stderr || '';
    if ((stdout + stderr).includes('[slimctx: ')) return null;
    const combined = stderr ? `${stdout}\n${stderr}` : stdout;
    const cmdNoQuotes = command.replace(/"[^"]*"|'[^']*'/g, '""');
    if (READ_INTENT.test(cmdNoQuotes)) return null;
    if (SEARCH_INTENT.test(cmdNoQuotes) && !/[|]/.test(cmdNoQuotes)) {
      const c = compressGrepContent(combined, cfg);
      const m = c && worthIt(combined, c, cfg);
      if (!m) return null;
      const file = cfg.stash ? stash(sid, combined, 'grep') : null;
      record({ host: 'claude', tool, cmd: command.slice(0, 120), before: m.before, after: m.after, passes: ['grep-cap'] });
      return { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: { ...resp, stdout: `${c}\n${footer(m, ['grep-cap'], file)}`, stderr: '' } } };
    }
    const r = shrinkCommandOutput({ text: combined, command, sessionId: sid, cfg, tool });
    if (!r) return null;
    updated = { ...resp, stdout: r.text, stderr: '' };
  } else if (tool === 'Grep') {
    if (isStashPath(input.path)) return null;
    if (resp.mode === 'content' && typeof resp.content === 'string') {
      const c = compressGrepContent(resp.content, cfg);
      const m = c && worthIt(resp.content, c, cfg);
      if (!m) return null;
      record({ host: 'claude', tool, cmd: String(input.pattern).slice(0, 80), before: m.before, after: m.after, passes: ['grep-cap'] });
      updated = { ...resp, content: `${c}\n[slimctx: grep capped at ${cfg.grep.maxPerFile}/file, ${cfg.grep.maxFiles} files — narrow with path/glob/head_limit for more]` };
    } else if (Array.isArray(resp.filenames)) {
      const list = compressPathList(resp.filenames, cfg.glob.maxEntries);
      if (!list) return null;
      const m = worthIt(resp.filenames.join('\n'), list.join('\n'), cfg);
      if (!m) return null;
      record({ host: 'claude', tool, cmd: String(input.pattern).slice(0, 80), before: m.before, after: m.after, passes: ['paths'] });
      updated = { ...resp, filenames: list };
    }
  } else if (tool === 'Glob' && Array.isArray(resp.filenames)) {
    const list = compressPathList(resp.filenames, cfg.glob.maxEntries);
    if (!list) return null;
    const m = worthIt(resp.filenames.join('\n'), list.join('\n'), cfg);
    if (!m) return null;
    record({ host: 'claude', tool, cmd: String(input.pattern).slice(0, 80), before: m.before, after: m.after, passes: ['paths'] });
    updated = { ...resp, filenames: list };
  }
  if (!updated) return null;
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: updated } };
}

// ---------- Claude Code PreToolUse ----------
const NOISY =
  /^(?:npx\s+|bunx\s+|pnpm\s+exec\s+)?(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|t|build|install|i|ci|add|lint|typecheck|check)\b|pytest\b|python3?\s+-m\s+(?:pytest|unittest|pip\s+install)\b|pip3?\s+install\b|uv\s+(?:sync|pip\s+install)\b|jest\b|vitest\b|mocha\b|tsc\b|eslint\b|ruff\b|mypy\b|cargo\s+(?:test|build|check|clippy)\b|go\s+(?:test|build|vet)\b|mvn\b|\.\/mvnw\b|gradle\b|\.\/gradlew\b|make\b|dotnet\s+(?:test|build|restore)\b|docker\s+(?:build|compose\s+build)\b|node\s+--test\b|node\s+test-all\.mjs\b|bundle\s+(?:install|exec\s+rspec)\b|rspec\b|phpunit\b|composer\s+install\b)/;

function otherBashRewriter() {
  // Two PreToolUse hooks returning updatedInput for the same call race, so
  // stand down when rtk (or anything that calls itself a rewriter) is set up.
  for (const f of [path.join(os.homedir(), '.claude', 'settings.json'), path.join(process.cwd(), '.claude', 'settings.json'), path.join(process.cwd(), '.claude', 'settings.local.json')]) {
    try {
      if (/rtk(\.exe)?\s+hook|rtk-rewrite|squeez|lean-ctx/.test(fs.readFileSync(f, 'utf8'))) return true;
    } catch {}
  }
  return false;
}

export function wrapCommand(command, root) {
  const m = command.match(/^(\s*cd\s+(?:"[^"]+"|'[^']+'|[^\s;&|]+)\s*&&\s*)?([\s\S]*?)(\s+2>&1)?\s*$/);
  if (!m) return null;
  const [, cd = '', rest] = m;
  if (/[|;&<>`$\n(){}]/.test(rest) || !NOISY.test(rest.trim())) return null;
  const bin = path.join(root, 'bin', 'slimctx.mjs').split(path.sep).join('/');
  return `${cd}node "${bin}" run -- ${rest.trim()}`;
}

export function onClaudePre(payload, root) {
  const cfg = loadConfig(payload.cwd);
  if (!cfg.enabled) return null;
  const { tool_name: tool, tool_input: input = {}, session_id: sid } = payload;

  if (tool === 'Bash') {
    if (cfg.wrap === false || cfg.wrap === 'off' || input.run_in_background) return null;
    const command = input.command || '';
    if (bypassed(command, cfg)) return null;
    if (cfg.wrap === 'auto' && otherBashRewriter()) return null;
    const wrapped = wrapCommand(command, root);
    if (!wrapped) return null;
    // No permissionDecision: the normal permission flow judges the
    // rewritten command, so slimctx never widens what is allowed.
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: { ...input, command: wrapped } } };
  }

  if (tool === 'Read' && cfg.outline?.enabled) {
    const file = input.file_path;
    if (!file || input.offset || input.limit || input.pages || isStashPath(file) || !outlinable(file)) return null;
    let content;
    try {
      const st = fs.statSync(file);
      if (st.size > 20e6 || st.size < cfg.outline.minLines * 20) return null;
      content = fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
    const lines = content.split('\n').length;
    if (lines < cfg.outline.minLines) return null;
    const state = loadSession(sid);
    const key = `${path.resolve(file)}:${lines}`;
    state.outlined = state.outlined || [];
    // Second whole-file request for the same file (same size): let it go.
    if (state.outlined.includes(key)) return null;
    const o = outline(file, content);
    if (!o || o.entries.length < 3) return null;
    const text = renderOutline(file, o);
    state.outlined = [key, ...state.outlined].slice(0, 200);
    saveSession(sid, state);
    const before = Math.min(estimateTokens(content), 25000);
    record({ host: 'claude', tool: 'Read', cmd: path.basename(file), before, after: estimateTokens(text), passes: ['outline'] });
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: text } };
  }
  return null;
}

// ---------- Codex PostToolUse ----------
// Codex cannot rewrite a tool result in place; a blocking PostToolUse
// "replaces the tool result with that feedback" and the turn continues.
// The command has already run, so nothing is undone.
function codexText(resp) {
  if (typeof resp === 'string') return resp;
  if (resp && typeof resp === 'object') {
    for (const k of ['output', 'aggregated_output', 'formatted_output', 'stdout', 'content']) {
      if (typeof resp[k] === 'string') return resp[k] + (k === 'stdout' && resp.stderr ? `\n${resp.stderr}` : '');
    }
  }
  return null;
}

export function onCodexPost(payload) {
  const cfg = loadConfig(payload.cwd);
  if (!cfg.enabled || payload.tool_name !== 'Bash') return null;
  const command = String(payload.tool_input?.command ?? '');
  if (bypassed(command, cfg)) return null;
  const text = codexText(payload.tool_response);
  if (!text || text.includes('[slimctx: ')) return null;
  // Keep Codex's own header (exit code, wall time) verbatim; squeeze the body.
  const split = text.match(/^([\s\S]*?\nOutput:\n)([\s\S]*)$/);
  const head = split ? split[1] : '';
  const body = split ? split[2] : text;
  const r = shrinkCommandOutput({ text: body, command, sessionId: payload.session_id, cfg, host: 'codex' });
  if (!r) return null;
  return {
    decision: 'block',
    reason: `${head}${r.text}\n(The command ran normally; slimctx condensed its output. This is not an error.)`,
  };
}
