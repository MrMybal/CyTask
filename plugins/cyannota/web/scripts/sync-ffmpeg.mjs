import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'node_modules', '@ffmpeg', 'core', 'dist', 'esm');
const target = resolve(root, 'public', 'ffmpeg');
const chunkBytes = 8 * 1024 * 1024;

await mkdir(target, { recursive: true });
for (const name of await readdir(target)) {
  if (name === 'ffmpeg-core.wasm' || /^ffmpeg-core\.wasm\.part\d+$/.test(name)
    || name === 'ffmpeg-core.wasm.parts.json') {
    await rm(resolve(target, name), { force: true });
  }
}

await copyFile(resolve(source, 'ffmpeg-core.js'), resolve(target, 'ffmpeg-core.js'));
const wasm = await readFile(resolve(source, 'ffmpeg-core.wasm'));
const parts = [];
for (let offset = 0, index = 0; offset < wasm.length; offset += chunkBytes, index += 1) {
  const name = 'ffmpeg-core.wasm.part' + index;
  await writeFile(resolve(target, name), wasm.subarray(offset, offset + chunkBytes));
  parts.push(name);
}
await writeFile(
  resolve(target, 'ffmpeg-core.wasm.parts.json'),
  JSON.stringify({ version: 1, size: wasm.length, parts }),
);

console.log('FFmpeg local synchronisé en ' + parts.length + ' blocs dans public/ffmpeg.');
