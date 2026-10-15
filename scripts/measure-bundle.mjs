import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const dir = path.resolve('dist');
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const entry = html.match(/type="module"[^>]*src="([^"]+)"/)[1].replace(/^\//, '');
const visited = new Set();
function dependencies(file) {
  if (visited.has(file)) return;
  visited.add(file);
  const source = fs.readFileSync(path.join(dir, file), 'utf8');
  for (const match of source.matchAll(/(?:from|import)\s*["'](\.\/[^"']+\.js)["']/g)) {
    dependencies(path.posix.join(path.posix.dirname(file), match[1]));
  }
}
dependencies(entry);
function size(files) {
  return files.reduce((result, file) => {
    const buffer = fs.readFileSync(path.join(dir, file));
    result.bytes += buffer.length;
    result.gzipBytes += gzipSync(buffer).length;
    return result;
  }, { bytes: 0, gzipBytes: 0 });
}
const assets = fs.readdirSync(path.join(dir, 'assets'));
const reports = assets.find(file => /^Reports-.*\.js$/.test(file));
const result = { entryJavaScript: { files: [...visited], ...size([...visited]) }, reportsPage: size([`assets/${reports}`]), totalJavaScript: size(assets.filter(file => file.endsWith('.js')).map(file => `assets/${file}`)) };
const output = process.argv[2] || 'screenshots/global-theme/bundle-after.json';
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
