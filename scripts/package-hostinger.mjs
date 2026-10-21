// Zips dist/ into a single archive for manual upload to Hostinger (public_html).
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ZipArchive } from 'archiver';

const root = path.resolve('dist');
const output = path.resolve('release', 'mooco-erp-hostinger.zip');

assert.ok(fs.existsSync(root), 'dist/ does not exist. Run `npm run build` first.');

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else files.push(file);
  }
}
walk(root);

const relative = (file) => path.relative(root, file).replace(/\\/g, '/');
assert.ok(files.some((file) => relative(file) === 'index.html'), 'index.html is missing from dist/');
assert.ok(files.some((file) => relative(file) === '.htaccess'), '.htaccess is missing from dist/');

fs.mkdirSync(path.dirname(output), { recursive: true });
await new Promise((resolve, reject) => {
  const stream = fs.createWriteStream(output);
  const archive = new ZipArchive({ zlib: { level: 9 } });
  stream.on('close', resolve);
  stream.on('error', reject);
  archive.on('error', reject);
  archive.pipe(stream);
  for (const file of files) archive.file(file, { name: relative(file) });
  archive.finalize().catch(reject);
});

const sizeMb = (fs.statSync(output).size / 1024 / 1024).toFixed(2);
console.log(`Created ${path.relative(process.cwd(), output)} (${sizeMb} MB, ${files.length} files)`);
