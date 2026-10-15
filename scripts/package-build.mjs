import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { ZipArchive } from 'archiver';

const root=path.resolve('dist');
const files=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else files.push(file);}}
walk(root);
assert.ok(files.some(file=>path.relative(root,file)==='index.html'));
const output=path.resolve('mooco_app_theme_fast.zip');
await new Promise((resolve,reject)=>{
  const stream=fs.createWriteStream(output);
  const archive=new ZipArchive({zlib:{level:9}});
  stream.on('close',resolve);stream.on('error',reject);archive.on('error',reject);archive.pipe(stream);
  for(const file of files)archive.file(file,{name:path.relative(root,file).replace(/\\/g,'/')});
  archive.finalize().catch(reject);
});
console.log(JSON.stringify({package:path.basename(output),files:files.length,bytes:fs.statSync(output).size}));
