// Text injected once per session (SessionStart). Kept deliberately short:
// these rules are paid for on every request, and caveman's own benchmark
// shows ~1.2k tokens of rules can cancel the output saving on short turns.

export const PROTOCOL =
  'Tool output may be condensed by slimctx. "… N lines omitted …", "[×N]" and "[slimctx: …]" mark removed or merged lines; ' +
  'the untouched original is in the file the footer names, so Read or grep that file when you need what was cut. ' +
  'Add the comment `# slimctx:raw` to a Bash command to get its output unfiltered.';

const LITE =
  'Reply style: lead with the answer or the action. No preamble, no recap of what you just did, no restating the question. ' +
  'Short sentences. Keep code, commands, paths, numbers and error text exact.';

const FULL =
  LITE +
  ' Drop filler and articles where meaning survives; fragments are fine. No narration between tool calls. ' +
  'Lists over paragraphs. Never drop "not", "never", "no" or "only".';

const CLARITY =
  ' Use full, plain sentences for security warnings, irreversible or destructive steps, and whenever the user seems confused; then return to the short style.';

export function sessionContext(cfg) {
  const parts = [PROTOCOL];
  if (cfg.terse === 'lite') parts.push(LITE + CLARITY);
  if (cfg.terse === 'full') parts.push(FULL + CLARITY);
  return parts.join('\n');
}
