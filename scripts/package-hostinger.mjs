import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ZipArchive } from 'archiver';

const root = path.resolve('dist');
assert.ok(fs.existsSync(root), 'dist directory does not exist! Run npm run build first.');

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(file);
    } else {
      files.push(file);
    }
  }
}
walk(root);

assert.ok(files.some(file => path.relative(root, file) === 'index.html'), 'index.html missing from dist');
assert.ok(files.some(file => path.relative(root, file) === '.htaccess'), '.htaccess missing from dist');

const outputFiles = ['hostinger-update.zip', 'mooco_erp_hostinger_build.zip'];

for (const outFile of outputFiles) {
  const outputPath = path.resolve(outFile);
  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(outputPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    stream.on('close', resolve);
    stream.on('error', reject);
    archive.on('error', reject);
    archive.pipe(stream);
    for (const file of files) {
      archive.file(file, { name: path.relative(root, file).replace(/\\/g, '/') });
    }
    archive.finalize().catch(reject);
  });
  console.log(`Created ${outFile} (${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB, ${files.length} files)`);
}
