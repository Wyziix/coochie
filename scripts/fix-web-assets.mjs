// After `expo export --platform web`: moves dist/assets/node_modules to
// dist/assets/vendor and rewrites the paths in the bundle. Cloudflare Pages
// (wrangler pages deploy) never uploads folders named node_modules, so without
// this the icon font and navigation images 404 on the live site and every
// icon disappears.
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const from = join(dist, 'assets', 'node_modules');
const to = join(dist, 'assets', 'vendor');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

if (existsSync(from)) renameSync(from, to);

let rewritten = 0;
for (const file of walk(dist).filter((f) => /\.(js|html|css|json)$/.test(f))) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('assets/node_modules/')) continue;
  writeFileSync(file, text.split('assets/node_modules/').join('assets/vendor/'));
  rewritten++;
}

const left = walk(dist).filter((f) => f.split(/[\\/]/).includes('node_modules'));
if (left.length) {
  console.error(`Still under node_modules (won't be deployed):\n${left.join('\n')}`);
  process.exit(1);
}
console.log(`web assets: node_modules → vendor, ${rewritten} files rewritten`);
