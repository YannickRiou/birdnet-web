// Vérifie que model/ (poids float16 + spectrogramme CPU de js/birdnet-core.js) donne les mêmes
// prédictions que le modèle officiel (poids float32 + couche tf.signal de l'exemple BirdNET).
// Prérequis : `python tools/build_model.py` puis `npm install`. Usage : npm run check
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as tf from '@tensorflow/tfjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
require(path.join(ROOT, 'js/birdnet-core.js'));
const { registerMelLayer, WINDOW } = globalThis.BirdNETCore;

// Charge un modèle TF.js depuis le disque (Node n'a pas de fetch sur fichiers locaux).
function fromDir(dir) {
  return {
    async load() {
      const json = JSON.parse(fs.readFileSync(path.join(dir, 'model.json'), 'utf8'));
      const specs = json.weightsManifest.flatMap((g) => g.weights);
      const data = Buffer.concat(json.weightsManifest.flatMap((g) => g.paths.map((p) => fs.readFileSync(path.join(dir, p)))));
      return { modelTopology: json.modelTopology, format: json.format, weightSpecs: specs,
        weightData: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
    },
  };
}

// Couche de référence : celle de l'exemple officiel BirdNET (main.js), simplifiée à un lot de 1.
class ReferenceMelLayer extends tf.layers.Layer {
  constructor(config) { super(config); Object.assign(this, config); this.fb = tf.tensor2d(config.melFilterbank); }
  build(s) { this.magScale = this.addWeight('magnitude_scaling', [], 'float32', tf.initializers.constant({ value: 1.23 })); super.build(s); }
  computeOutputShape(s) { return [s[0], this.specShape[0], this.specShape[1], 1]; }
  call(inputs) {
    return tf.tidy(() => {
      let x = (Array.isArray(inputs) ? inputs[0] : inputs).squeeze();
      x = x.sub(x.min(-1, true)); x = x.div(x.max(-1, true).add(1e-6)).sub(0.5).mul(2);
      let s = tf.cast(tf.signal.stft(x, this.frameLength, this.frameStep, this.frameLength, tf.signal.hannWindow), 'float32');
      s = tf.matMul(s, this.fb).pow(2).pow(tf.div(1, tf.add(1, tf.exp(this.magScale.read()))));
      return tf.stack([tf.transpose(tf.reverse(s, -1)).expandDims(-1)]);
    });
  }
  static get className() { return 'MelSpecLayerSimple'; }
}

function readWav(file) {
  const b = fs.readFileSync(file);
  const n = (b.length - 44) / 2;
  const x = new Float32Array(WINDOW);
  for (let i = 0; i < Math.min(n, WINDOW); i++) x[i] = b.readInt16LE(44 + 2 * i) / 32768;
  return x;
}

async function predict(dir, layer, audio) {
  tf.serialization.registerClass(layer); // la dernière classe enregistrée sous ce nom l'emporte
  const model = await tf.loadLayersModel(fromDir(dir));
  const t = performance.now();
  const out = await model.predict(tf.tensor2d(audio, [1, WINDOW])).data();
  return { out, ms: performance.now() - t };
}

const sample = readWav(path.join(ROOT, '.cache/orig/sample.wav'));
const species = JSON.parse(fs.readFileSync(path.join(ROOT, 'model/species.json'), 'utf8'));

// 1. Spectrogrammes : couche CPU vs couche tf.signal, à partir du même modèle.
const ref = await predict(path.join(ROOT, '.cache/orig/model'), ReferenceMelLayer, sample);
const ours = await predict(path.join(ROOT, 'model/audio'), registerMelLayer(tf), sample);

const top = (p) => [...p].map((v, i) => [i, v]).sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log('Officiel (float32 + tf.signal) :', ref.ms.toFixed(0), 'ms');
for (const [i, v] of top(ref.out)) console.log(`  ${v.toFixed(4)}  ${species[i][1]}`);
console.log('Site (float16 + mel CPU) :', ours.ms.toFixed(0), 'ms');
for (const [i, v] of top(ours.out)) console.log(`  ${v.toFixed(4)}  ${species[i][1]}`);
let maxDiff = 0;
for (let i = 0; i < ref.out.length; i++) maxDiff = Math.max(maxDiff, Math.abs(ref.out[i] - ours.out[i]));
console.log('Écart max sur les 6522 scores :', maxDiff.toExponential(2));
if (maxDiff > 0.02) { console.error('ÉCHEC : écart trop grand'); process.exit(1); }
console.log('OK');
