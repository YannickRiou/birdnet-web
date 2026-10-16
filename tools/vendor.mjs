// Copie TensorFlow.js (Apache-2.0) depuis node_modules vers vendor/, servi tel quel par le site.
// Usage : npm install && npm run vendor
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const NM = path.join(ROOT, 'node_modules/@tensorflow');
const OUT = path.join(ROOT, 'vendor');
const FILES = [
  ['tfjs/dist/tf.min.js', 'tf.min.js'],
  ['tfjs-backend-wasm/dist/tf-backend-wasm.min.js', 'tf-backend-wasm.min.js'],
  ['tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm', 'tfjs-backend-wasm.wasm'],
  ['tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm', 'tfjs-backend-wasm-simd.wasm'],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [src, dst] of FILES) {
  fs.copyFileSync(path.join(NM, src), path.join(OUT, dst));
  // Retire le lien vers la source map, non fournie.
  if (dst.endsWith('.js')) {
    const file = path.join(OUT, dst);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\n\/\/# sourceMappingURL=.*\n?$/, '\n'));
  }
  console.log('vendor/' + dst);
}

// Le paquet npm n'inclut pas le texte de la licence : on prend celui du dépôt, à la même version.
const license = await fetch('https://raw.githubusercontent.com/tensorflow/tfjs/tfjs-v4.22.0/LICENSE');
fs.writeFileSync(path.join(OUT, 'LICENSE-tfjs.txt'), await license.text());
console.log('vendor/LICENSE-tfjs.txt');
