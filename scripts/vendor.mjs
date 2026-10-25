// Copies the ffmpeg.wasm runtime from node_modules into vendor/ so the
// extension can be loaded unpacked without a build step.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const targets = [
  ['node_modules/@ffmpeg/ffmpeg/dist/esm', 'vendor/ffmpeg'],
  ['node_modules/@ffmpeg/core/dist/esm', 'vendor/ffmpeg-core'],
];

for (const [from, to] of targets) {
  const dest = join(root, to);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const file of readdirSync(join(root, from))) {
    if (file.endsWith('.d.ts') || file.endsWith('.d.mts')) continue;
    cpSync(join(root, from, file), join(dest, file));
  }
  console.log(`copied ${from} -> ${to}`);
}
