// After `expo export --platform web`: writes dist/sw.js with the list of files
// to precache and a version that changes whenever any of them changes.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const SKIP = new Set(['_headers', '_redirects', 'metadata.json', 'sw.js', 'index.html']);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(dist)
  .map((path) => '/' + relative(dist, path).split('\\').join('/'))
  .filter((url) => !SKIP.has(url.slice(1)) && !url.endsWith('.map'))
  .sort();

const hash = createHash('sha256');
for (const url of ['/index.html', ...files]) {
  hash.update(url);
  hash.update(readFileSync(join(dist, url)));
}
const version = hash.digest('hex').slice(0, 16);

// '/' is the app shell (index.html); Cloudflare Pages redirects /index.html to /.
const precache = ['/', ...files];
const sw = readFileSync(join(root, 'scripts/sw.template.js'), 'utf8')
  .replace('__VERSION__', version)
  .replace('__FILES__', JSON.stringify(precache));
writeFileSync(join(dist, 'sw.js'), sw);

const bytes = files.reduce((n, url) => n + statSync(join(dist, url)).size, 0);
console.log(`sw.js: version ${version}, ${precache.length} files, ${(bytes / 1e6).toFixed(1)} MB`);
