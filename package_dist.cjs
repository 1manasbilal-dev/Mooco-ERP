const fs = require('fs');
const path = require('path');
const { ZipArchive } = require('archiver');

const distPath = path.resolve(__dirname, 'dist');
const zipPath = path.resolve(__dirname, 'mooco_erp_hostinger_build.zip');
const hostingerZipPath = path.resolve(__dirname, 'hostinger-update.zip');

if (!fs.existsSync(distPath)) {
  console.error('ERROR: dist/ not found — run "npm run build" first.');
  process.exit(1);
}

if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

const output = fs.createWriteStream(zipPath);
const archive = new ZipArchive({ zlib: { level: 9 } });

output.on('close', () => {
  fs.copyFileSync(zipPath, hostingerZipPath);
  console.log(`SUCCESS: Created mooco_erp_hostinger_build.zip and hostinger-update.zip (${(archive.pointer() / 1024).toFixed(1)} KB)`);
  console.log(`Location: ${zipPath}`);
});

archive.on('error', (err) => { throw err; });
archive.pipe(output);

// Recursively add all files from dist/ into root of zip
function addDirRecursive(dir, zipPrefix = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const zipEntryPath = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      addDirRecursive(fullPath, zipEntryPath);
    } else if (entry.isFile()) {
      archive.file(fullPath, { name: zipEntryPath });
    }
  }
}

addDirRecursive(distPath, '');

archive.finalize();
