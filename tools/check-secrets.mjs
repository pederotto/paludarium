// Secret guard: keeps keys, tokens and passwords out of git and out of the built game (docs/SECURITY.md).
// The game runs entirely in the player's browser and the repo is public, so everything in dist/ and
// everything committed is readable by anyone. Secrets live in a local .env file, which git ignores.
//
//   node tools/check-secrets.mjs            every tracked file (npm run secrets; also tests/secrets.test.mjs)
//   node tools/check-secrets.mjs --staged   what is about to be committed (.githooks/pre-commit)
//   node tools/check-secrets.mjs --dist     the built game (postbuild, so also every Pages deploy)
//   node tools/check-secrets.mjs --install  point git at .githooks/ (runs on npm install)
//
// A line that trips a pattern by mistake can carry the marker `secrets-ok` to be skipped.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Token formats with a fixed prefix: almost never a false alarm, so they also run on the minified build.
const TOKENS = [
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})/],
  ['Anthropic API key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI-style API key', /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Stripe live key', /\b[rs]k_live_[A-Za-z0-9]{20,}/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/],
];
// Looser shapes, for source files only: a password inside a URL, a quoted value assigned to a secret-sounding name.
const LOOSE = [
  ['password in a URL', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/'"]+:([^\s@/'"]{6,})@/i],
  ['hard-coded secret', /\b(?:api[_-]?key|secret(?:[_-]?key)?|client[_-]?secret|access[_-]?token|auth[_-]?token|password|passwd)["']?\s*[:=]\s*["'`]([^"'`\s]{8,})["'`]/i],
  ['npm auth token', /_authToken\s*=\s*([^\s]{8,})/],
];
// A loose match whose value is a placeholder or a reference, not a secret.
const PLACEHOLDER = /^(?:\$|\{|<|%|process\.env|import\.meta|your|changeme|example|placeholder|dummy|test|fake|x{4,}|\*{4,})/i;

const BINARY = /\.(?:glb|gltf|bin|png|jpe?g|webp|gif|ico|avif|ktx2|basis|hdr|exr|woff2?|ttf|otf|mp3|ogg|wav|mp4|webm|zip|gz|7z|blend|fbx|obj|psd|pdf)$/i;
const ENV_OK = /^\.env\.(?:example|sample|template)$/;

/** Why a file must never be committed or shipped, judged by its name alone (null when the name is fine). */
export function badName(file) {
  const base = path.basename(file);
  if (/^\.env(?:\..+)?$/.test(base) && !ENV_OK.test(base)) return 'environment file (keep it local; commit .env.example instead)';
  if (/\.(?:pem|key|p12|pfx|keystore|jks)$/i.test(base)) return 'key or certificate file';
  if (/^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$/.test(base)) return 'SSH key';
  if (/^(?:credentials|service[-_]account.*)\.json$/i.test(base) || base === '.netrc' || base === '.git-credentials') return 'credentials file';
  return null;
}

/** Secret-looking strings in one text. `loose` adds the source-code shapes (off for the minified build). */
export function scanText(text, { loose = true } = {}) {
  const found = [];
  const lines = text.split('\n');
  const rules = loose ? [...TOKENS, ...LOOSE] : TOKENS;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('secrets-ok')) continue;
    for (const [what, re] of rules) {
      const m = re.exec(line);
      if (!m) continue;
      if (m[1] !== undefined && PLACEHOLDER.test(m[1])) continue;
      found.push({ line: i + 1, what, sample: mask(m[0]) });
      break;
    }
  }
  return found;
}

// Enough of a match to find it again, not enough to leak it a second time in a log.
function mask(s) { return s.length <= 10 ? s.slice(0, 3) + '…' : s.slice(0, 8) + '…' + `(${s.length} chars)`; }

const git = (args, opts = {}) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 1 << 28, ...opts });

function scanFiles(files, read, { loose = true } = {}) {
  const problems = [];
  for (const file of files) {
    const why = badName(file);
    if (why) { problems.push({ file, what: why }); continue; }
    if (BINARY.test(file)) continue;
    let buf;
    try { buf = read(file); } catch { continue; }            // listed but gone from disk (a pending delete)
    if (!buf || buf.subarray(0, 8000).includes(0)) continue; // binary
    for (const hit of scanText(buf.toString('utf8'), { loose })) problems.push({ file, ...hit });
  }
  return problems;
}

/** Every file git tracks, as it is on disk now. */
export function scanTracked() {
  const files = git(['ls-files', '-z']).toString().split('\0').filter(Boolean);
  return scanFiles(files, (f) => fs.readFileSync(path.join(ROOT, f)));
}

/** The files staged for the next commit, as staged (not as they are on disk). */
export function scanStaged() {
  const files = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).toString().split('\0').filter(Boolean);
  return scanFiles(files, (f) => git(['show', `:${f}`], { stdio: ['ignore', 'pipe', 'ignore'] }));
}

/** The built game: token formats, key files, and any value from a local .env that leaked into the bundle. */
export function scanDist(dir = path.join(ROOT, 'dist')) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else files.push(path.relative(ROOT, p));
    }
  })(dir);
  const problems = scanFiles(files, (f) => fs.readFileSync(path.join(ROOT, f)), { loose: false });
  const values = localEnvValues();
  if (values.length) {
    for (const file of files) {
      if (BINARY.test(file)) continue;
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      for (const { name, value } of values) if (text.includes(value)) problems.push({ file, what: `value of ${name} from your .env is in the build (a VITE_ variable ships to every player)` });
    }
  }
  return problems;
}

// Values from local .env files that look like they could be secrets (long enough not to match by chance).
function localEnvValues() {
  const out = [];
  for (const f of fs.readdirSync(ROOT)) {
    if (!/^\.env(?:\..+)?$/.test(f) || ENV_OK.test(f)) continue;
    for (const line of fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const value = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      if (value.length >= 8 && !/^(?:true|false|\d+(?:\.\d+)?)$/i.test(value)) out.push({ name: m[1], value });
    }
  }
  return out;
}

/** Point this clone's git hooks at .githooks/ so the pre-commit check runs. Quiet outside a git checkout. */
export function installHook() {
  try { git(['rev-parse', '--git-dir'], { stdio: 'ignore' }); } catch { return; }
  let current = '';
  try { current = git(['config', '--get', 'core.hooksPath']).toString().trim(); } catch { /* unset */ }
  if (current === '.githooks') return;
  if (current) { console.log(`[secrets] core.hooksPath is already "${current}"; not changing it. The pre-commit check lives in .githooks/pre-commit.`); return; }
  git(['config', 'core.hooksPath', '.githooks']);
  console.log('[secrets] git hooks now run from .githooks/ (pre-commit secret check).');
}

function report(problems, where) {
  if (!problems.length) { console.log(`[secrets] ${where}: clean.`); return 0; }
  console.error(`[secrets] ${where}: ${problems.length} problem${problems.length > 1 ? 's' : ''}:`);
  for (const p of problems) console.error(`  ${p.file}${p.line ? ':' + p.line : ''}  ${p.what}${p.sample ? '  ' + p.sample : ''}`);
  console.error('Keep secrets in .env (git ignores it) and read them from code that runs on your machine, never in the game. See docs/SECURITY.md.');
  console.error('A false alarm on one line: add the comment `secrets-ok` to that line.');
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const arg = process.argv[2] ?? '';
  if (arg === '--install') installHook();
  else if (arg === '--staged') process.exitCode = report(scanStaged(), 'staged files');
  else if (arg === '--dist') process.exitCode = report(scanDist(), 'dist/');
  else process.exitCode = report(scanTracked(), 'tracked files');
}
