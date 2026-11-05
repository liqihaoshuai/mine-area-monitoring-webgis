/**
 * ensure-dist.mjs — production build freshness guard.
 *
 * Compares the newest source mtime under frontend\src (plus index.html and
 * vite.config.js) against dist\index.html (the build stamp). If dist is missing
 * or older than any source file, run `vite build` before the server starts.
 *
 * Exit codes: 0 = dist is fresh or build succeeded, 1 = build failed.
 *
 * Output is English on purpose: the batch launcher runs under the OEM codepage
 * (GBK/936 on zh-CN), so UTF-8 Chinese would render as mojibake in that console.
 */
import { spawnSync } from 'node:child_process';
import { statSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, '..');
const SRC = join(FRONTEND, 'src');
const DIST_INDEX = join(FRONTEND, 'dist', 'index.html');

/** Newest mtime (ms) among files under `dir`, recursive. Skips node_modules. */
function newestMtime(dir) {
  let newest = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtime(full));
    } else if (entry.isFile()) {
      try {
        newest = Math.max(newest, statSync(full).mtimeMs);
      } catch {
        /* ignore unreadable file */
      }
    }
  }
  return newest;
}

function stamp(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function say(line) {
  process.stdout.write(`  ${line}\n`);
}

const hasDist = existsSync(DIST_INDEX);
const distTime = stamp(DIST_INDEX);

// Only these entry points matter; docs/, dist/ and logs are irrelevant.
const srcTime = newestMtime(SRC);
const entryTime = Math.max(
  stamp(join(FRONTEND, 'index.html')),
  stamp(join(FRONTEND, 'vite.config.js')),
  stamp(join(FRONTEND, 'package.json'))
);
const newest = Math.max(srcTime, entryTime);

if (hasDist && distTime >= newest) {
  const age = Math.round((Date.now() - distTime) / 1000);
  say(`dist is up to date (built ${age}s ago).`);
  process.exit(0);
}

const reason = hasDist ? 'source is newer than dist' : 'dist is missing';
say(`${reason}, running "npm run build" ...`);

const npmCli = join(FRONTEND, '..', 'tools', 'node22', 'node_modules', 'npm', 'bin', 'npm-cli.js');
const result = spawnSync(process.execPath, [npmCli, 'run', 'build'], {
  cwd: FRONTEND,
  stdio: 'inherit'
});

if (result.status !== 0) {
  say('[ERROR] frontend build failed. The server was NOT started, because');
  say('        serving a stale dist/ would show outdated pages.');
  say('        Fix the build errors above, or run "npm run dev" for the dev server.');
  process.exit(1);
}

if (!existsSync(DIST_INDEX)) {
  say('[ERROR] build reported success but dist/index.html is still missing.');
  process.exit(1);
}

say('frontend build complete.');
process.exit(0);
