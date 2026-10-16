/*
 * Worker d'inférence BirdNET : tout le calcul tourne ici, l'interface reste fluide.
 *
 * Messages reçus :
 *   {type:'init', backend?}           charge le modèle, choisit le moteur le plus rapide
 *   {type:'audioPort', port}          port direct depuis l'AudioWorklet (échantillons 48 kHz)
 *   {type:'listen', on}               démarre / arrête l'analyse en continu
 *   {type:'location', points, area}   espèces probables sur une zone (modèle géographique)
 *   {type:'file', samples}            analyse un enregistrement complet (48 kHz)
 * Messages envoyés : progress, ready, result, geo, fileResult, fileDone, error.
 * result et fileResult portent `clip` : les 3 s analysées plus du contexte (1,5 s de chaque côté en fichier,
 * 3 s avant en direct), en Float32Array 48 kHz, ou null sans détection.
 */
/* global tf, BirdNETCore */
importScripts('../vendor/tf.min.js', '../vendor/tf-backend-wasm.min.js', 'birdnet-core.js');

const { WINDOW, SAMPLE_RATE, registerMelLayer } = BirdNETCore;
const MODEL_URL = new URL('../model/audio/model.json', self.location).href;
const GEO_URL = new URL('../model/geo/model.json', self.location).href;
const HOP = 1.5 * SAMPLE_RATE; // nouvelle analyse toutes les 1,5 s (chevauchement de moitié)
const MIN_SCORE = 0.1; // les scores plus bas ne sont pas transmis à l'interface
const MAX_RESULTS = 5;
const PAD = 1.5 * SAMPLE_RATE; // contexte ajouté de chaque côté de la fenêtre pour la réécoute (fichier)

let model = null;
let listening = false;
let busy = false;
// Tampon circulaire des 6 dernières secondes : 3 s analysées + 3 s de contexte pour la réécoute.
const RING = 2 * WINDOW;
const ring = new Float32Array(RING);
let written = 0; // échantillons reçus depuis le début de l'écoute
let lastRun = 0; // valeur de `written` lors de la dernière analyse

const post = (msg, transfer) => self.postMessage(msg, transfer || []);

async function useBackend(name) {
  try {
    if (!(await tf.setBackend(name))) return false;
    await tf.ready();
    // Sur certains GPU mobiles, WebGL ne calcule qu'en 16 bits : résultats faussés, on l'écarte.
    if (name === 'webgl' && !tf.env().getBool('WEBGL_RENDER_FLOAT32_ENABLED')) return false;
    return true;
  } catch (e) {
    return false;
  }
}

async function infer(samples) {
  const input = tf.tensor2d(samples, [1, WINDOW]);
  const output = model.predict(input);
  const scores = await output.data();
  input.dispose();
  output.dispose();
  return scores;
}

function topScores(scores) {
  const out = [];
  for (let i = 0; i < scores.length; i++) if (scores[i] >= MIN_SCORE) out.push([i, scores[i]]);
  return out.sort((a, b) => b[1] - a[1]).slice(0, MAX_RESULTS);
}

/** Temps d'une inférence, après une première passe de « chauffe » (compilation des shaders). */
async function benchmark() {
  const noise = new Float32Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) noise[i] = Math.random() * 2 - 1;
  await infer(noise);
  const t = performance.now();
  await infer(noise);
  return performance.now() - t;
}

async function init(preferred) {
  tf.wasm.setWasmPaths(new URL('../vendor/', self.location).href);
  tf.enableProdMode();
  registerMelLayer(tf);

  const candidates = preferred ? [preferred] : ['webgl', 'wasm'];
  let backend = null;
  for (const name of candidates) {
    if (await useBackend(name)) { backend = name; break; }
  }
  if (!backend) { await useBackend('cpu'); backend = 'cpu'; }

  model = await tf.loadLayersModel(MODEL_URL, { onProgress: (p) => post({ type: 'progress', value: p }) });
  let ms = await benchmark();

  // GPU lent ou indisponible : on compare avec WebAssembly et on garde le plus rapide.
  if (!preferred && backend === 'webgl' && ms > 600 && (await useBackend('wasm'))) {
    const wasmMs = await benchmark();
    if (wasmMs < ms) { backend = 'wasm'; ms = wasmMs; } else { await useBackend('webgl'); }
  }
  post({ type: 'ready', backend, ms: Math.round(ms) });
}

function onAudio(chunk) {
  if (!listening) return;
  let offset = written % RING;
  for (let i = 0; i < chunk.length; i++) {
    ring[offset++] = chunk[i];
    if (offset === RING) offset = 0;
  }
  written += chunk.length;
  schedule();
}

async function schedule() {
  // Si l'analyse prend plus de 1,5 s (vieux téléphone), on analyse simplement la fenêtre la plus récente.
  if (busy || !model || written < WINDOW || written - lastRun < HOP) return;
  busy = true;
  lastRun = written;
  // Copie des derniers échantillons (jusqu'à 6 s) : le tampon continue de se remplir pendant l'inférence.
  const snap = new Float32Array(Math.min(written, RING));
  const end = written % RING; // prochaine case à écrire = fin des données
  const tail = Math.min(snap.length, end);
  snap.set(ring.subarray(end - tail, end), snap.length - tail);
  if (tail < snap.length) snap.set(ring.subarray(RING - (snap.length - tail)), 0);
  try {
    const t = performance.now();
    const scores = await infer(snap.subarray(snap.length - WINDOW));
    const detections = topScores(scores);
    // L'extrait accompagne les détections, pour pouvoir le réécouter (transfert sans copie).
    const clip = detections.length ? snap : null;
    if (listening) post({ type: 'result', detections, clip, ms: Math.round(performance.now() - t) }, clip ? [clip.buffer] : []);
  } catch (e) {
    post({ type: 'error', message: String(e && e.message || e) });
  }
  busy = false;
  schedule();
}

async function analyzeFile(samples) {
  // Fenêtres de 3 s sans chevauchement (réglage par défaut de BirdNET) ; la dernière est complétée par du silence.
  const chunk = new Float32Array(WINDOW);
  for (let start = 0; start < samples.length; start += WINDOW) {
    const part = samples.subarray(start, start + WINDOW);
    if (part.length < SAMPLE_RATE && start > 0) break; // moins d'une seconde : ignoré
    chunk.fill(0);
    chunk.set(part);
    const scores = await infer(chunk);
    const detections = topScores(scores);
    const clip = detections.length ? samples.slice(Math.max(0, start - PAD), start + WINDOW + PAD) : null;
    post({ type: 'fileResult', time: start / SAMPLE_RATE, detections, clip,
      progress: Math.min(1, (start + WINDOW) / samples.length) }, clip ? [clip.buffer] : []);
  }
  post({ type: 'fileDone' });
}

/** points : [[lat, lon, semaine], …]. Score d'une espèce = son maximum sur l'ensemble des points. */
async function geoFilter(points) {
  // Modèle chargé à la demande puis libéré : la mémoire compte sur un iPhone 8.
  const geo = await tf.loadGraphModel(GEO_URL);
  const input = tf.tensor2d(points);
  const output = geo.predict(input);
  const best = output.max(0);
  const scores = await best.data();
  tf.dispose([input, output, best]);
  geo.dispose();
  return Float32Array.from(scores);
}

self.onmessage = async ({ data }) => {
  try {
    switch (data.type) {
      case 'init':
        await init(data.backend);
        break;
      case 'audioPort':
        data.port.onmessage = (e) => onAudio(e.data);
        break;
      case 'listen':
        listening = data.on;
        written = 0;
        lastRun = 0;
        break;
      case 'location': {
        const scores = await geoFilter(data.points);
        post({ type: 'geo', scores, area: data.area }, [scores.buffer]);
        break;
      }
      case 'file':
        await analyzeFile(data.samples);
        break;
    }
  } catch (e) {
    post({ type: 'error', message: String(e && e.message || e), during: data.type });
  }
};
