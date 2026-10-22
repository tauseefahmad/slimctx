// Lines that are pure progress/transport chatter in package managers,
// build tools, git transport and docker. Dropped wherever they appear, but
// only when there are enough of them to matter, and never if they carry an
// error word.
import { isImportant } from '../text.mjs';

const NOISE = [
  // npm / pnpm / yarn / bun
  /^npm (http|timing|sill|verb|info)\b/,
  /^(npm )?WARN deprecated\b/,
  /^\s*(Progress|Resolving|Fetching|Linking|Packages):/,
  /^\[\d+\/\d+\] (Resolving|Fetching|Linking|Building)/,
  /^\s*\d+ packages? (are|is) looking for funding/,
  /^\s*run `npm fund` for details/,
  // pip / uv / poetry
  /^\s*(Collecting|Downloading|Using cached|Requirement already satisfied|Obtaining|Building wheel|Created wheel|Stored in directory|Preparing metadata|Getting requirements|Installing build dependencies)\b/,
  /^\s*(Resolved|Prepared|Installed|Audited|Uninstalled) \d+ packages? in /,
  // cargo / go
  /^\s*(Compiling|Checking|Fresh|Downloaded|Downloading|Locking|Adding)\s+\S+ v\d/,
  /^\s*(Updating crates\.io index|Blocking waiting for file lock)/,
  /^go: (downloading|finding|extracting) /,
  // maven / gradle
  /^\[INFO\] (Download(ing|ed) from|Copying|Using 'UTF-8'|skip non existing resourceDirectory|--- |Building jar|Nothing to compile|Changes detected|Compiling \d+ source)/,
  /^\[INFO\]\s*$/,
  /^\[INFO\] -{20,}$/,
  /^Download(ing)? https?:\/\//,
  /^> Task :\S+( UP-TO-DATE| NO-SOURCE| FROM-CACHE| SKIPPED)?$/,
  // git transport
  /^(remote: )?(Enumerating|Counting|Compressing|Writing|Receiving|Resolving) (objects|deltas)\b/,
  /^remote: Total \d+/,
  // docker / buildkit
  /^#\d+ (sha256:|extracting|resolve |transferring|\[internal\]|DONE \d|CACHED)/,
  /^#\d+ \d+(\.\d+)?s? ?$/,
  /^ ?[0-9a-f]{12}: (Pulling fs layer|Waiting|Downloading|Verifying Checksum|Download complete|Extracting|Pull complete|Already exists)/,
];

export function dropNoise(lines) {
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!isImportant(l) && NOISE.some((re) => re.test(l))) hits.push(i);
  }
  if (hits.length < 5) return { lines, saved: 0 };
  const drop = new Set(hits);
  const out = [];
  let run = 0;
  for (let i = 0; i < lines.length; i++) {
    if (drop.has(i)) {
      run++;
      continue;
    }
    if (run) out.push(`  … ${run} progress/download lines …`);
    run = 0;
    out.push(lines[i]);
  }
  if (run) out.push(`  … ${run} progress/download lines …`);
  return { lines: out, saved: hits.length };
}
